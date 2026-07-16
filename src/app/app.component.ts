import { Component } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

type ScanState = "idle" | "scanning" | "ready" | "error";
type SyncState = "idle" | "syncing" | "success" | "error";
type SubmitState = "idle" | "submitting" | "success" | "error";

const SYNC_ENDPOINT = "https://fpsbuddy.io/api/helper/sync";
const ANONYMOUS_USER_ID_KEY = "fpsbuddy.helper.anonymous-user-id";
const SUBMIT_URL = "https://fpsbuddy.io/submit";
const CATALOG_ENDPOINT = "https://fpsbuddy.io/api/helper/catalog";
const SUBMIT_ENDPOINT = "https://fpsbuddy.io/api/helper/submit";

interface CatalogItem { id: string; name: string; }
interface CatalogGame { slug: string; name: string; genre: string; }
interface CatalogData { cpus: CatalogItem[]; gpus: CatalogItem[]; games: CatalogGame[]; }

interface BenchmarkDraft {
  submitter: string;
  cpuId: string;
  gpuId: string;
  ramGb: number;
  gameSlug: string;
  resolution: string;
  preset: string;
  driverVersion: string;
  osVersion: string;
  gameVersion: string;
  upscaler: string;
  upscalerMode: string;
  frameGeneration: string;
  rayTracing: string;
  textureQuality: string;
  shadowQuality: string;
  vsync: boolean;
  hdrEnabled: boolean;
  avgFps: number;
  low1pct: number;
  medianFps: number;
  low0p1pctFps: number;
  cpuUtilAvgPct: number;
  gpuUtilAvgPct: number;
  cpuTempC: number;
  gpuTempC: number;
  notes: string;
}

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
  catalog: CatalogData | null = null;
  catalogState: "idle" | "loading" | "ready" | "error" = "idle";
  submitState: SubmitState = "idle";
  submitMessage = "";
  draft: BenchmarkDraft = this.createDraft();

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
      this.applyDetectedHardware();
      await this.loadCatalog();
    } catch (error) {
      this.syncState = "error";
      this.syncMessage = error instanceof Error ? error.message : "The snapshot could not be synced.";
    }
  }

  async loadCatalog(): Promise<void> {
    this.catalogState = "loading";
    try {
      const response = await fetch(CATALOG_ENDPOINT);
      const result = (await response.json()) as { catalog?: CatalogData };
      if (!response.ok || !result.catalog) throw new Error("CATALOG_UNAVAILABLE");
      this.catalog = result.catalog;
      this.catalogState = "ready";
      this.applyDetectedHardware();
    } catch {
      this.catalogState = "error";
    }
  }

  async submit(): Promise<void> {
    if (!this.snapshot || !this.verificationToken || this.submitState === "submitting") return;
    if (!this.draft.submitter.trim() || !this.draft.cpuId || !this.draft.gpuId || !this.draft.gameSlug) {
      this.submitState = "error";
      this.submitMessage = "Choose hardware, a game, and a display name before submitting.";
      return;
    }
    if (this.draft.avgFps < 5 || this.draft.low1pct < 1) {
      this.submitState = "error";
      this.submitMessage = "Average FPS must be at least 5 and 1% low must be at least 1.";
      return;
    }

    this.submitState = "submitting";
    this.submitMessage = "";
    try {
      const response = await fetch(SUBMIT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...this.draft,
          submitter: this.draft.submitter.trim(),
          notes: this.draft.notes.trim() || undefined,
          helperVerificationToken: this.verificationToken,
          anonymousUserId: this.getAnonymousUserId(),
          ramGb: Math.round(this.draft.ramGb),
          avgFps: Math.round(this.draft.avgFps),
          low1pct: Math.round(this.draft.low1pct),
          medianFps: this.draft.medianFps || undefined,
          low0p1pctFps: this.draft.low0p1pctFps || undefined,
          cpuUtilAvgPct: this.draft.cpuUtilAvgPct || undefined,
          gpuUtilAvgPct: this.draft.gpuUtilAvgPct || undefined,
          cpuTempC: this.draft.cpuTempC || undefined,
          gpuTempC: this.draft.gpuTempC || undefined,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; id?: string; verified?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "SUBMISSION_FAILED");
      this.submitState = "success";
      this.submitMessage = result.verified ? "Benchmark submitted and verified." : "Benchmark submitted to FPSBuddy.";
    } catch (error) {
      this.submitState = "error";
      this.submitMessage = error instanceof Error ? error.message : "The benchmark could not be submitted.";
    }
  }

  private createDraft(): BenchmarkDraft {
    return {
      submitter: "", cpuId: "", gpuId: "", ramGb: 16, gameSlug: "", resolution: "1440p", preset: "High",
      driverVersion: "", osVersion: "", gameVersion: "", upscaler: "", upscalerMode: "", frameGeneration: "",
      rayTracing: "", textureQuality: "", shadowQuality: "", vsync: false, hdrEnabled: false, avgFps: 0,
      low1pct: 0, medianFps: 0, low0p1pctFps: 0, cpuUtilAvgPct: 0, gpuUtilAvgPct: 0, cpuTempC: 0, gpuTempC: 0, notes: "",
    };
  }

  private applyDetectedHardware(): void {
    if (!this.snapshot || !this.catalog) return;
    const cpuName = (this.snapshot.cpu.model || this.snapshot.cpu.brand || "").toLowerCase();
    const gpuName = (this.snapshot.gpus[0]?.model || "").toLowerCase();
    this.draft.cpuId = this.catalog.cpus.find((item) => cpuName.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(cpuName))?.id ?? this.draft.cpuId;
    this.draft.gpuId = this.catalog.gpus.find((item) => gpuName.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(gpuName))?.id ?? this.draft.gpuId;
    this.draft.ramGb = Math.max(4, Math.round(this.snapshot.memory.totalGb));
    this.draft.driverVersion = this.snapshot.gpus[0]?.driverVersion ?? this.draft.driverVersion;
    this.draft.osVersion = [this.snapshot.operatingSystem.name, this.snapshot.operatingSystem.version].filter(Boolean).join(" ");
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
