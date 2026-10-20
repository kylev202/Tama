//! Master volume of the default playback device.

use serde::Serialize;
use windows::core::Result;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

#[derive(Serialize)]
pub struct Volume {
    level: f32,
    muted: bool,
}

fn endpoint() -> Result<IAudioEndpointVolume> {
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        devices.GetDefaultAudioEndpoint(eRender, eConsole)?.Activate(CLSCTX_ALL, None)
    }
}

pub fn get() -> Result<Volume> {
    let endpoint = endpoint()?;
    unsafe {
        Ok(Volume {
            level: endpoint.GetMasterVolumeLevelScalar()?,
            muted: endpoint.GetMute()?.as_bool(),
        })
    }
}

pub fn set_level(level: f32) -> Result<()> {
    unsafe { endpoint()?.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null()) }
}

pub fn set_muted(muted: bool) -> Result<()> {
    unsafe { endpoint()?.SetMute(muted, std::ptr::null()) }
}
