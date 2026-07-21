import { Component } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

type ScanState = "idle" | "scanning" | "ready" | "error";
type SyncState = "idle" | "syncing" | "success" | "error";
type SubmitState = "idle" | "submitting" | "success" | "error";

const FPSBUDDY_ORIGIN = "https://www.fpsbuddy.io";
const SYNC_ENDPOINT = `${FPSBUDDY_ORIGIN}/api/helper/sync`;
const ANONYMOUS_USER_ID_KEY = "fpsbuddy.helper.anonymous-user-id";
const SUBMIT_URL = `${FPSBUDDY_ORIGIN}/submit`;
const CATALOG_ENDPOINT = `${FPSBUDDY_ORIGIN}/api/helper/catalog`;
const SUBMIT_ENDPOINT = `${FPSBUDDY_ORIGIN}/api/helper/submit`;

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
      await this.loadCatalog();
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
      const result = (await response.json()) as { ok?: boolean; code?: string; reason?: string; verificationToken?: string };
      if (!response.ok || !result.ok) {
        const reason = result.reason === "HELPER_SNAPSHOT_TABLE_MISSING"
          ? "The FPSBuddy database is missing the Helper snapshot table. Apply the Helper migrations and redeploy the web app."
          : result.reason === "HELPER_SNAPSHOT_SCHEMA_OUTDATED"
            ? "The FPSBuddy database has an older Helper snapshot schema. Apply the latest Helper migrations and redeploy the web app."
            : result.reason === "DATABASE_INSERT_FAILED"
              ? "FPSBuddy could not save the snapshot. Check the web server database configuration and try again."
              : result.code ?? "SYNC_FAILED";
        throw new Error(reason);
      }
      this.verificationToken = result.verificationToken ?? "";
      this.syncState = "success";
      this.syncMessage = "Hardware snapshot synced to FPSBuddy.";
      this.applyDetectedHardware();
      await this.loadCatalog();
    } catch (error) {
      this.syncState = "error";
      this.syncMessage = this.networkErrorMessage(error, "The snapshot could not be synced.");
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
      this.submitMessage = this.networkErrorMessage(error, "The benchmark could not be submitted.");
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
    const cpuName = this.normalizeHardwareName(this.snapshot.cpu.model || this.snapshot.cpu.brand || "");
    const gpuName = this.normalizeHardwareName(this.snapshot.gpus[0]?.model || "");
    const findCatalogMatch = (detectedName: string, items: CatalogItem[]): string | undefined => {
      const normalizedItems = items.map((item) => ({ item, name: this.normalizeHardwareName(item.name) }));
      return normalizedItems.find(({ name }) => name === detectedName)?.item.id
        ?? normalizedItems.find(({ name }) => detectedName.includes(name))?.item.id;
    };
    this.draft.cpuId = findCatalogMatch(cpuName, this.catalog.cpus) ?? this.draft.cpuId;
    this.draft.gpuId = findCatalogMatch(gpuName, this.catalog.gpus) ?? this.draft.gpuId;
    this.draft.ramGb = Math.max(4, Math.round(this.snapshot.memory.totalGb));
    this.draft.driverVersion = this.snapshot.gpus[0]?.driverVersion ?? this.draft.driverVersion;
    this.draft.osVersion = [this.snapshot.operatingSystem.name, this.snapshot.operatingSystem.version].filter(Boolean).join(" ");
  }

  private normalizeHardwareName(value: string): string {
    return value
      .toLowerCase()
      .replace(/\s+\d+(?:-core| core) processor\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
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

  private networkErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof TypeError && error.message.toLowerCase().includes("fetch")) {
      return "FPSBuddy could not be reached. Check your internet connection and try again.";
    }
    return error instanceof Error ? error.message : fallback;
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
