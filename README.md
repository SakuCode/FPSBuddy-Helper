# FPSBuddy Helper

FPSBuddy Helper is a small desktop companion for FPSBuddy. It reads static hardware and operating system information from the local PC, shows the results for review, and lets the user explicitly share the snapshot with FPSBuddy for performance guidance and benchmark verification.

The desktop shell is built with [Tauri 2](https://tauri.app/) and the interface is built with [Angular 20](https://angular.dev/). The native collector currently uses the Rust [`sysinfo`](https://crates.io/crates/sysinfo) crate.

## Current workflow

1. Select **Scan this PC** to collect a local hardware snapshot.
2. Review the detected processor, graphics adapters, memory, storage, operating system, and displays.
3. Enable the sharing consent control.
4. Select **Sync to FPSBuddy** to send the reviewed snapshot to `https://fpsbuddy.io/api/helper/sync`.
5. After a successful sync, complete the benchmark form in Helper. Hardware is prefilled when it can be matched to the FPSBuddy catalog; ambiguous hardware requires manual confirmation.
6. Submit the game, settings, FPS results, and optional advanced metrics directly to FPSBuddy.

The scan itself does not upload data. The current version collects static information only; it does not collect serial numbers, file paths, running applications, or automatically detect game data. Sync is disabled until the user opts in. Game selection, settings, and performance results are entered manually for now.

## Requirements

- Windows 10 or later
- [Node.js](https://nodejs.org/) with npm
- [Rust](https://www.rust-lang.org/tools/install) and Cargo
- Microsoft C++ Build Tools with the Desktop development with C++ workload
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) runtime

For a more complete Tauri development environment, install the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your operating system. VS Code extensions for [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode), [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer), and [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template) are recommended.

## Getting started

From this directory, install the JavaScript dependencies:

```powershell
npm install
```

Start the Angular frontend in a browser:

```powershell
npm start
```

The development server runs at `http://localhost:1420` when started directly. This port is configured in `angular.json` and `src-tauri/tauri.conf.json`.

Start the complete desktop application with hot reload:

```powershell
npm run tauri dev
```

Tauri runs `npm run start` automatically before launching the desktop window.

## Commands

| Command | Description |
| --- | --- |
| `npm start` | Run the Angular development server on port 1420. |
| `npm run build` | Create a production Angular build. |
| `npm run watch` | Rebuild the Angular app when source files change. |
| `npm run tauri dev` | Run the Tauri desktop application in development mode. |
| `npm run tauri build` | Build release installers and bundles for the current platform. |
| `npm run ng -- <command>` | Run an Angular CLI command. |

## Project structure

```text
src/
	app/                 Angular application and scan/sync workflow
	assets/              Frontend assets
	main.ts              Angular bootstrap entry point
	styles.css           Global styles
src-tauri/
	src/lib.rs           Tauri setup and command registration
	src/hardware.rs      Native hardware snapshot collection
	src/main.rs          Native application entry point
	tauri.conf.json      Tauri build and window configuration
```

## Data and integration notes

- The Angular app invokes the native `collect_hardware` command through Tauri.
- The sync request contains the snapshot, an anonymous locally stored user ID, and `hardwareShareOptIn: true`.
- The anonymous ID is stored in browser local storage under `fpsbuddy.helper.anonymous-user-id`.
- The sync response returns a one-use verification token used by the direct benchmark submission request.
- Helper loads catalog choices from `https://fpsbuddy.io/api/helper/catalog` and submits to `https://fpsbuddy.io/api/helper/submit`.
- Guest submissions use the locally stored anonymous ID and require a display name. The server endpoint also accepts a validated bearer token for the account-pairing flow that will be added next.
- The current Helper submission stores the normalized benchmark fields in `user_benchmarks`; the raw hardware snapshot remains in `helper_hardware_snapshots`.
- The sync and submission state are currently defined in `src/app/app.component.ts`.

Review the snapshot and consent behavior before changing the sync payload or the fields collected by the native layer. Changes to the snapshot shape should stay aligned between `src-tauri/src/hardware.rs` and `src/app/app.component.ts`.

## Building a release

Run:

```powershell
npm run tauri build
```

The Tauri bundle is generated under `src-tauri/target/release/bundle/`. The exact installer format depends on the target platform and the installed Tauri toolchain.
