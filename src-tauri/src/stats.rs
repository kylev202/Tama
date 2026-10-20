//! Live PC stats for the Stats section: CPU, GPU, memory, disk, network and battery.
//! Nothing samples in the background: the section asks once a second while it's open.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2, MIB_IF_TYPE_LOOPBACK};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhGetFormattedCounterValue,
    PdhOpenQueryW, PDH_CSTATUS_NEW_DATA, PDH_FMT_COUNTERVALUE, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
    PDH_HCOUNTER, PDH_HQUERY,
};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::SystemInformation::{GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX};

/// Rates from an older sample would average over the whole gap.
const STALE: Duration = Duration::from_secs(3);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Percentages from 0 to 100. Rates are missing when Windows has no counter for them.
    cpu: Option<f64>,
    /// GHz.
    cpu_speed: Option<f64>,
    gpu: Option<f64>,
    /// Bytes of dedicated GPU memory in use.
    gpu_memory: Option<f64>,
    memory_used: u64,
    memory_total: u64,
    /// The busiest disk's active time.
    disk: Option<f64>,
    /// The Windows drive, such as "C:", and its space in bytes.
    drive: String,
    drive_free: u64,
    drive_total: u64,
    /// Bytes per second over the connected network adapters, and the busiest one's name.
    down: Option<f64>,
    up: Option<f64>,
    network: Option<String>,
    battery: Option<Battery>,
    /// Seconds since Windows started.
    uptime: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    percent: u8,
    plugged_in: bool,
}

struct Sampler {
    query: PDH_HQUERY,
    cpu: PDH_HCOUNTER,
    base_speed: PDH_HCOUNTER,
    speed_share: PDH_HCOUNTER,
    gpu_engines: PDH_HCOUNTER,
    gpu_memory: PDH_HCOUNTER,
    disk_idle: PDH_HCOUNTER,
    /// When the last sample was taken, and the bytes the network adapters had moved by then.
    taken: Option<Instant>,
    octets: Option<(u64, u64)>,
}

// PDH handles point at PDH's own data, and the mutex keeps them to one thread at a time.
unsafe impl Send for Sampler {}

static SAMPLER: Mutex<Option<Sampler>> = Mutex::new(None);

#[tauri::command]
pub async fn stats_get() -> Result<Stats, String> {
    tauri::async_runtime::spawn_blocking(|| SAMPLER.lock().unwrap().get_or_insert_with(Sampler::open).sample())
        .await
        .map_err(|e| e.to_string())
}

impl Sampler {
    fn open() -> Self {
        let mut query = PDH_HQUERY::default();
        unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut query) };
        // A counter Windows doesn't have (no GPU counters in some VMs) stays null and reads as missing.
        let add = |path: PCWSTR| {
            let mut counter = PDH_HCOUNTER::default();
            unsafe { PdhAddEnglishCounterW(query, path, 0, &mut counter) };
            counter
        };
        Sampler {
            query,
            // Processor Utility is what Task Manager shows; Processor Time reads low on boosting CPUs.
            cpu: add(w!(r"\Processor Information(_Total)\% Processor Utility")),
            base_speed: add(w!(r"\Processor Information(_Total)\Processor Frequency")),
            speed_share: add(w!(r"\Processor Information(_Total)\% Processor Performance")),
            gpu_engines: add(w!(r"\GPU Engine(*)\Utilization Percentage")),
            gpu_memory: add(w!(r"\GPU Adapter Memory(*)\Dedicated Usage")),
            disk_idle: add(w!(r"\PhysicalDisk(*)\% Idle Time")),
            taken: None,
            octets: None,
        }
    }

    fn sample(&mut self) -> Stats {
        if self.taken.is_none_or(|at| at.elapsed() >= STALE) {
            self.collect();
            std::thread::sleep(Duration::from_millis(250));
        }
        let (then, before) = (self.taken, self.octets);
        let network = self.collect();
        let seconds = then.map(|at| self.taken.unwrap().duration_since(at).as_secs_f64());
        let rate = |now: u64, earlier: u64| seconds.map(|s| now.saturating_sub(earlier) as f64 / s);
        let (down, up) = match (before, self.octets) {
            (Some((down0, up0)), Some((down1, up1))) => (rate(down1, down0), rate(up1, up0)),
            _ => (None, None),
        };

        let mut memory = MEMORYSTATUSEX { dwLength: size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        let _ = unsafe { GlobalMemoryStatusEx(&mut memory) };

        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let (mut drive_free, mut drive_total) = (0, 0);
        let _ = unsafe {
            GetDiskFreeSpaceExW(&HSTRING::from(format!(r"{drive}\")), None, Some(&mut drive_total), Some(&mut drive_free))
        };

        let speed = value(self.base_speed).zip(value(self.speed_share)).map(|(mhz, share)| mhz * share / 100.0 / 1000.0);
        Stats {
            cpu: value(self.cpu),
            cpu_speed: speed.filter(|ghz| *ghz > 0.0),
            gpu: busiest_engine(self.gpu_engines),
            gpu_memory: Some(instances(self.gpu_memory).iter().map(|(_, bytes)| bytes).sum()).filter(|bytes| *bytes > 0.0),
            memory_used: memory.ullTotalPhys - memory.ullAvailPhys,
            memory_total: memory.ullTotalPhys,
            disk: instances(self.disk_idle)
                .into_iter()
                .filter(|(name, _)| name != "_Total")
                .map(|(_, idle)| (100.0 - idle).clamp(0.0, 100.0))
                .reduce(f64::max),
            drive,
            drive_free,
            drive_total,
            down,
            up,
            network: network.and_then(|n| n.name),
            battery: battery(),
            uptime: unsafe { GetTickCount64() } / 1000,
        }
    }

    fn collect(&mut self) -> Option<Network> {
        unsafe { PdhCollectQueryData(self.query) };
        let network = network();
        self.taken = Some(Instant::now());
        self.octets = network.as_ref().map(|n| (n.down, n.up));
        network
    }
}

/// A single-instance counter's value.
fn value(counter: PDH_HCOUNTER) -> Option<f64> {
    let mut value = PDH_FMT_COUNTERVALUE::default();
    let status = unsafe { PdhGetFormattedCounterValue(counter, PDH_FMT_DOUBLE, None, &mut value) };
    (status == 0 && value.CStatus <= PDH_CSTATUS_NEW_DATA).then_some(unsafe { value.Anonymous.doubleValue })
}

/// Every instance of a wildcard counter, as (instance name, value).
fn instances(counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
    let (mut size, mut count) = (0u32, 0u32);
    unsafe { PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None) };
    if size == 0 {
        return Vec::new();
    }
    // u64s keep the items aligned; PDH writes the instance names after them in the same buffer.
    let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
    let items = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
    if unsafe { PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) } != 0 {
        return Vec::new();
    }
    unsafe { std::slice::from_raw_parts(items, count as usize) }
        .iter()
        .filter(|item| item.FmtValue.CStatus <= PDH_CSTATUS_NEW_DATA)
        .map(|item| unsafe { (item.szName.to_string().unwrap_or_default(), item.FmtValue.Anonymous.doubleValue) })
        .collect()
}

/// The busiest GPU engine, as Task Manager counts it. Instances are per process and engine
/// ("pid_1234_luid_0x0_0x1A2B_phys_0_eng_0_engtype_3D"), so each engine's processes add up first.
fn busiest_engine(counter: PDH_HCOUNTER) -> Option<f64> {
    let mut engines: HashMap<String, f64> = HashMap::new();
    for (name, value) in instances(counter) {
        let engine = name.split_once("_luid_").map_or(name.as_str(), |(_, engine)| engine).to_owned();
        *engines.entry(engine).or_default() += value;
    }
    engines.into_values().reduce(f64::max).map(|busy| busy.min(100.0))
}

struct Network {
    down: u64,
    up: u64,
    name: Option<String>,
}

/// Bytes received and sent since boot by the connected network adapters.
fn network() -> Option<Network> {
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    if unsafe { GetIfTable2(&mut table) }.is_err() {
        return None;
    }
    let rows = unsafe { std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize) };
    let mut total = Network { down: 0, up: 0, name: None };
    let mut busiest = 0;
    for row in rows {
        // Real adapters only. Windows also lists filter layers and virtual adapters that carry
        // the same traffic again. Bit 0 is HardwareInterface, bit 1 FilterInterface.
        let flags = row.InterfaceAndOperStatusFlags._bitfield;
        if flags & 0b01 == 0 || flags & 0b10 != 0 || row.OperStatus != IfOperStatusUp || row.Type == MIB_IF_TYPE_LOOPBACK {
            continue;
        }
        total.down += row.InOctets;
        total.up += row.OutOctets;
        if row.InOctets + row.OutOctets >= busiest {
            busiest = row.InOctets + row.OutOctets;
            let len = row.Alias.iter().position(|&c| c == 0).unwrap_or(row.Alias.len());
            total.name = Some(String::from_utf16_lossy(&row.Alias[..len]));
        }
    }
    unsafe { FreeMibTable(table as *const _) };
    Some(total)
}

fn battery() -> Option<Battery> {
    let mut power = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut power) }.ok()?;
    // Flag 128 means no battery; 255 means unknown.
    (power.BatteryFlag & 128 == 0 && power.BatteryLifePercent <= 100)
        .then_some(Battery { percent: power.BatteryLifePercent, plugged_in: power.ACLineStatus == 1 })
}
