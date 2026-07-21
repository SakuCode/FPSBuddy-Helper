use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{DiskKind, Disks, System};

const SCHEMA_VERSION: &str = "hardware.v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSnapshot {
    pub schema_version: &'static str,
    pub captured_at: u64,
    pub helper_version: &'static str,
    pub platform: &'static str,
    pub cpu: CpuSnapshot,
    pub gpus: Vec<GpuSnapshot>,
    pub memory: MemorySnapshot,
    pub storage: Vec<StorageSnapshot>,
    pub operating_system: OperatingSystemSnapshot,
    pub displays: Vec<DisplaySnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuSnapshot {
    pub brand: Option<String>,
    pub model: Option<String>,
    pub architecture: String,
    pub core_count: Option<usize>,
    pub thread_count: usize,
    pub base_clock_ghz: Option<f64>,
    pub boost_clock_ghz: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSnapshot {
    pub vendor: Option<String>,
    pub model: Option<String>,
    pub vram_gb: Option<f64>,
    pub driver_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub total_gb: f64,
    pub speed_mts: Option<u32>,
    pub memory_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub kind: String,
    pub capacity_gb: f64,
    pub interface: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatingSystemSnapshot {
    pub name: Option<String>,
    pub version: Option<String>,
    pub build: Option<String>,
    pub architecture: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySnapshot {
    pub resolution: Option<String>,
    pub refresh_rate_hz: Option<f64>,
}

pub fn collect() -> HardwareSnapshot {
    let mut system = System::new_all();
    system.refresh_all();

    let first_cpu = system.cpus().first();
    let thread_count = system.cpus().len();
    let disks = Disks::new_with_refreshed_list();

    HardwareSnapshot {
        schema_version: SCHEMA_VERSION,
        captured_at: now_millis(),
        helper_version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        cpu: CpuSnapshot {
            brand: first_cpu
                .map(|cpu| cpu.brand().trim().to_owned())
                .filter(|value| !value.is_empty()),
            model: first_cpu
                .map(|cpu| {
                    let model = normalize_cpu_model(cpu.name());
                    if is_generic_cpu_model(&model) {
                        normalize_cpu_model(cpu.brand())
                    } else {
                        model
                    }
                })
                .filter(|value| !value.is_empty()),
            architecture: std::env::consts::ARCH.to_owned(),
            core_count: System::physical_core_count(),
            thread_count,
            base_clock_ghz: None,
            boost_clock_ghz: None,
        },
        gpus: collect_gpus(),
        memory: MemorySnapshot {
            total_gb: bytes_to_gb(system.total_memory()),
            speed_mts: None,
            memory_type: None,
        },
        storage: disks
            .iter()
            .map(|disk| StorageSnapshot {
                kind: disk_kind(disk.kind()),
                capacity_gb: bytes_to_gb(disk.total_space()),
                interface: None,
            })
            .collect(),
        operating_system: OperatingSystemSnapshot {
            name: System::name(),
            version: System::os_version(),
            build: System::kernel_version(),
            architecture: std::env::consts::ARCH.to_owned(),
        },
        displays: collect_displays(),
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn bytes_to_gb(bytes: u64) -> f64 {
    (bytes as f64 / 1_073_741_824.0 * 100.0).round() / 100.0
}

fn normalize_cpu_model(value: &str) -> String {
    let trimmed = value.trim();
    let suffix = " core processor";
    let Some(prefix) = trimmed
        .get(..trimmed.len().saturating_sub(suffix.len()))
        .filter(|_| trimmed.to_ascii_lowercase().ends_with(suffix))
    else {
        return trimmed.to_owned();
    };
    let prefix = prefix.trim_end_matches('-').trim_end();
    let Some((model, core_count)) = prefix.rsplit_once(' ') else {
        return trimmed.to_owned();
    };
    if core_count
        .chars()
        .all(|character| character.is_ascii_digit())
    {
        model.to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn is_generic_cpu_model(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized == "cpu"
        || (normalized.starts_with("cpu ")
            && normalized[4..]
                .chars()
                .all(|character| character.is_ascii_digit()))
}

fn disk_kind(kind: DiskKind) -> String {
    match kind {
        DiskKind::HDD => "hdd".to_owned(),
        DiskKind::SSD => "ssd".to_owned(),
        DiskKind::Unknown(_) => "unknown".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{bytes_to_gb, disk_kind, is_generic_cpu_model, normalize_cpu_model};
    use sysinfo::DiskKind;

    #[test]
    fn normalizes_bytes_to_rounded_gigabytes() {
        assert_eq!(bytes_to_gb(1_073_741_824), 1.0);
        assert_eq!(bytes_to_gb(1_610_612_736), 1.5);
    }

    #[test]
    fn normalizes_disk_kind_without_exposing_device_paths() {
        assert_eq!(disk_kind(DiskKind::SSD), "ssd");
        assert_eq!(disk_kind(DiskKind::HDD), "hdd");
    }

    #[test]
    fn prefers_the_brand_when_sysinfo_returns_a_generic_cpu_name() {
        assert!(is_generic_cpu_model("CPU 1"));
        assert_eq!(
            normalize_cpu_model("AMD Ryzen 7 5700X3D 8-Core Processor"),
            "AMD Ryzen 7 5700X3D"
        );
    }
}

#[cfg(windows)]
fn collect_gpus() -> Vec<GpuSnapshot> {
    let mut gpus = collect_gpus_wmi()
        .filter(|gpus| !gpus.is_empty())
        .or_else(collect_gpus_powershell)
        .filter(|gpus| !gpus.is_empty())
        .unwrap_or_else(unavailable_gpus);
    enrich_gpu_vram(&mut gpus);
    gpus
}

#[cfg(windows)]
fn enrich_gpu_vram(gpus: &mut [GpuSnapshot]) {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};

    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return;
    };
    let mut index = 0;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(index) } {
        let Ok(description) = (unsafe { adapter.GetDesc1() }) else {
            index += 1;
            continue;
        };
        if description.DedicatedVideoMemory == 0 {
            index += 1;
            continue;
        }
        let adapter_name = String::from_utf16_lossy(&description.Description)
            .trim_end_matches('\0')
            .to_lowercase();
        if let Some(gpu) = gpus.iter_mut().find(|gpu| {
            gpu.model
                .as_ref()
                .map(|model| {
                    adapter_name.contains(&model.to_lowercase())
                        || model.to_lowercase().contains(&adapter_name)
                })
                .unwrap_or(false)
        }) {
            gpu.vram_gb = Some(bytes_to_gb(description.DedicatedVideoMemory as u64));
        }
        index += 1;
    }
}

#[cfg(windows)]
fn collect_gpus_wmi() -> Option<Vec<GpuSnapshot>> {
    use std::collections::HashMap;
    use wmi::{COMLibrary, Variant, WMIConnection};

    let Ok(com) = COMLibrary::new() else {
        return None;
    };
    let Ok(connection) = WMIConnection::new(com) else {
        return None;
    };
    let Ok(controllers) = connection.raw_query::<HashMap<String, Variant>>(
        "SELECT Name, AdapterRAM, DriverVersion FROM Win32_VideoController",
    ) else {
        return None;
    };

    let gpus = controllers
        .into_iter()
        .filter_map(|controller| {
            let model = variant_string(controller.get("Name"));
            let driver_version = variant_string(controller.get("DriverVersion"));
            let vram_gb = variant_u64(controller.get("AdapterRAM")).map(bytes_to_gb);
            if model.is_none() && driver_version.is_none() && vram_gb.is_none() {
                return None;
            }
            Some(GpuSnapshot {
                vendor: None,
                model,
                vram_gb,
                driver_version,
            })
        })
        .collect::<Vec<_>>();

    Some(gpus)
}

#[cfg(windows)]
fn collect_gpus_powershell() -> Option<Vec<GpuSnapshot>> {
    use std::process::Command;

    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion | ConvertTo-Json -Compress",
        ])
        .output()
        .ok()?;
    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }

    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let records = value.as_array().cloned().unwrap_or_else(|| vec![value]);
    let gpus = records
        .into_iter()
        .filter_map(|record| {
            let model = json_string(record.get("Name"));
            let driver_version = json_string(record.get("DriverVersion"));
            let vram_gb = json_u64(record.get("AdapterRAM")).map(bytes_to_gb);
            if model.is_none() && driver_version.is_none() && vram_gb.is_none() {
                return None;
            }
            Some(GpuSnapshot {
                vendor: None,
                model,
                vram_gb,
                driver_version,
            })
        })
        .collect();

    Some(gpus)
}

#[cfg(windows)]
fn variant_string(value: Option<&wmi::Variant>) -> Option<String> {
    match value {
        Some(wmi::Variant::String(value)) => non_empty(value.clone()),
        _ => None,
    }
}

#[cfg(windows)]
fn variant_u64(value: Option<&wmi::Variant>) -> Option<u64> {
    match value {
        Some(wmi::Variant::UI1(value)) => Some(u64::from(*value)),
        Some(wmi::Variant::UI2(value)) => Some(u64::from(*value)),
        Some(wmi::Variant::UI4(value)) => Some(u64::from(*value)),
        Some(wmi::Variant::UI8(value)) => Some(*value),
        Some(wmi::Variant::I1(value)) if *value >= 0 => Some(*value as u64),
        Some(wmi::Variant::I2(value)) if *value >= 0 => Some(*value as u64),
        Some(wmi::Variant::I4(value)) if *value >= 0 => Some(*value as u64),
        Some(wmi::Variant::I8(value)) if *value >= 0 => Some(*value as u64),
        _ => None,
    }
}

#[cfg(windows)]
fn json_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .and_then(non_empty)
}

#[cfg(windows)]
fn json_u64(value: Option<&serde_json::Value>) -> Option<u64> {
    value.and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

#[cfg(not(windows))]
fn collect_gpus() -> Vec<GpuSnapshot> {
    unavailable_gpus()
}

fn unavailable_gpus() -> Vec<GpuSnapshot> {
    vec![GpuSnapshot {
        vendor: None,
        model: None,
        vram_gb: None,
        driver_version: None,
    }]
}

#[cfg(windows)]
fn collect_displays() -> Vec<DisplaySnapshot> {
    use std::mem::{size_of, zeroed};
    use windows::Win32::Graphics::Gdi::{EnumDisplaySettingsW, DEVMODEW, ENUM_CURRENT_SETTINGS};
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SYSTEM_METRICS_INDEX};

    let mut mode = unsafe { zeroed::<DEVMODEW>() };
    mode.dmSize = size_of::<DEVMODEW>() as u16;
    let refresh_rate = unsafe { EnumDisplaySettingsW(None, ENUM_CURRENT_SETTINGS, &mut mode) }
        .as_bool()
        .then_some(mode.dmDisplayFrequency as f64)
        .filter(|rate| *rate > 0.0);
    let width = unsafe { GetSystemMetrics(SYSTEM_METRICS_INDEX(0)) };
    let height = unsafe { GetSystemMetrics(SYSTEM_METRICS_INDEX(1)) };

    vec![DisplaySnapshot {
        resolution: (width > 0 && height > 0).then(|| format!("{width}x{height}")),
        refresh_rate_hz: refresh_rate,
    }]
}

#[cfg(not(windows))]
fn collect_displays() -> Vec<DisplaySnapshot> {
    vec![DisplaySnapshot {
        resolution: None,
        refresh_rate_hz: None,
    }]
}

#[cfg(windows)]
fn non_empty(value: String) -> Option<String> {
    let value = value.trim().to_owned();
    (!value.is_empty()).then_some(value)
}
