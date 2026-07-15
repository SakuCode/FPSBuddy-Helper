use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, DiskKind, System};

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
            brand: first_cpu.map(|cpu| cpu.brand().trim().to_owned()).filter(|value| !value.is_empty()),
            model: first_cpu.map(|cpu| cpu.name().trim().to_owned()).filter(|value| !value.is_empty()),
            architecture: std::env::consts::ARCH.to_owned(),
            core_count: System::physical_core_count(),
            thread_count,
            base_clock_ghz: None,
            boost_clock_ghz: None,
        },
        gpus: vec![GpuSnapshot {
            vendor: None,
            model: None,
            vram_gb: None,
            driver_version: None,
        }],
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
        displays: vec![DisplaySnapshot {
            resolution: None,
            refresh_rate_hz: None,
        }],
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

fn disk_kind(kind: DiskKind) -> String {
    match kind {
        DiskKind::HDD => "hdd".to_owned(),
        DiskKind::SSD => "ssd".to_owned(),
        DiskKind::Unknown(_) => "unknown".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{bytes_to_gb, disk_kind};
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
}