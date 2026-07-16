import { Component } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

type ScanState = "idle" | "scanning" | "ready" | "error";
type SyncState = "idle" | "syncing" | "success" | "error";

const SYNC_ENDPOINT = "https://fpsbuddy.io/api/helper/sync";
const ANONYMOUS_USER_ID_KEY = "fpsbuddy.helper.anonymous-user-id";
const SUBMIT_URL = "https://fpsbuddy.io/submit";

interface HardwareSnapshot {
  schemaVersion: string;
  capturedAt: number;
  helperVersion: string;
  platform: string;
  cpu: {
    brand: string | null;
    model: string | null;
    architecture: string;
    coreCount: number | null;
    threadCount: number;
    baseClockGhz: number | null;
    boostClockGhz: number | null;
  };
  gpus: Array<{
    vendor: string | null;
    model: string | null;
    vramGb: number | null;
    driverVersion: string | null;
  }>;
  memory: {
    totalGb: number;
    speedMts: number | null;
    memoryType: string | null;
  };
  storage: Array<{
    kind: string;
    capacityGb: number;
    interface: string | null;
  }>;
  operatingSystem: {
    name: string | null;
    version: string | null;
    build: string | null;
    architecture: string;
  };
  displays: Array<{
    resolution: string | null;
    refreshRateHz: number | null;
  }>;
}

@Component({
  selector: "app-root",
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  scanState: ScanState = "idle";
  snapshot: HardwareSnapshot | null = null;
  consentGiven = false;
  errorMessage = "";
  syncState: SyncState = "idle";
  syncMessage = "";
  verificationToken = "";

  async scan(): Promise<void> {
    this.scanState = "scanning";
    this.errorMessage = "";

    try {
      this.snapshot = await invoke<HardwareSnapshot>("collect_hardware");
      this.scanState = "ready";
    } catch (error) {
      this.scanState = "error";
      this.errorMessage = error instanceof Error ? error.message : "The hardware scan could not be completed.";
    }
  }

  async sync(): Promise<void> {
    if (!this.snapshot || !this.consentGiven || this.syncState === "syncing") return;

    this.syncState = "syncing";
    this.syncMessage = "";

    try {
      const response = await fetch(SYNC_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snapshot: this.snapshot,
          anonymousUserId: this.getAnonymousUserId(),
          hardwareShareOptIn: true,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; code?: string; verificationToken?: string };
      if (!response.ok || !result.ok) throw new Error(result.code ?? "SYNC_FAILED");
      this.verificationToken = result.verificationToken ?? "";
      this.syncState = "success";
      this.syncMessage = "Hardware snapshot synced to FPSBuddy.";
    } catch (error) {
      this.syncState = "error";
      this.syncMessage = error instanceof Error ? error.message : "The snapshot could not be synced.";
    }
  }

  get benchmarkUrl(): string {
    return this.verificationToken ? `${SUBMIT_URL}?helperToken=${encodeURIComponent(this.verificationToken)}` : SUBMIT_URL;
  }

  private getAnonymousUserId(): string {
    const existing = localStorage.getItem(ANONYMOUS_USER_ID_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    localStorage.setItem(ANONYMOUS_USER_ID_KEY, generated);
    return generated;
  }

  displayValue(value: string | number | null | undefined): string {
    return value === null || value === undefined || value === "" ? "Unavailable" : String(value);
  }

  displayKind(value: string): string {
    return value.toUpperCase();
  }

  formatCapturedAt(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamp);
  }
}
