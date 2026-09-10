# Installation Guide — dsh-setting-manager

> The expanded version of the [README installation section](../README.md),
> covering the five steps: prerequisites, install, verify, update, uninstall.
> 中文: [installation.zh.md](./installation.zh.md)

## Prerequisites

1. **DSH (DeepSeek Harness) installed**, with an initialized `web` profile
   (the plugin is installed into that profile: `--profile web`).
2. **Node.js ≥ 22** (the plugin package declares `node >= 22` in `engines`).
3. **pnpm**. `dsh plugin` manages plugins through pnpm, so it must be
   installed. This package is pure JS with no build step, so the from-source
   path needs no extra dependency or build commands.

## Installation

### From npm (recommended)

```powershell
dsh plugin --profile web add dsh-setting-manager
```

### From source (trial / development)

Best for trying the plugin from source or keeping it mounted while developing.
Clone the repo, then install from its root:

```powershell
git clone https://github.com/coderHeJiyu/dsh-setting-manager.git
cd dsh-setting-manager
dsh plugin --profile web add .
```

The package is pure JS; `lib/` is the source, so no `pnpm install` or build
is needed. The final `add .` runs in the repo root and installs the current
directory. You can also skip the clone and install the repo directly:

```powershell
dsh plugin --profile web add github:coderHeJiyu/dsh-setting-manager
```

This form pulls the HEAD of the repository's default branch.

## Verification

```powershell
dsh plugin --profile web list
dsh web --dump-config | Select-String setting-manager
```

Check each item:

1. `dsh plugin --profile web list` shows `dsh-setting-manager`, meaning the
   plugin is registered in the web profile;
2. `dsh web --dump-config | Select-String setting-manager` hits the plugin's
   profile bundle row (the `setting-manager` entry inserted by
   `cordis.patch.yml`);
3. **Restart the DSH Web GUI** (re-run `dsh web`). The host route and the
   client entry both load at boot;
4. Open the settings page and right-click the section navigation on the left:
   the 设置菜单 ("Settings Menu") check menu appears;
5. Toggle a section: it disappears from the navigation, and
   `$DSH_HOME/dsh-setting-manager.json` is created (default
   `~/.dsh/dsh-setting-manager.json`). The state survives page refresh and
   browser switches.

## Updating

- **npm install**: upgrade to the latest published version:

  ```powershell
  dsh plugin --profile web update dsh-setting-manager
  ```

- **From source**: refresh the repo (e.g. `git pull`), and re-run from the
  repo root:

  ```powershell
  dsh plugin --profile web add .
  ```

- After updating, restart the GUI to apply.
- The state file `$DSH_HOME/dsh-setting-manager.json` does not depend on the
  plugin version; updates never delete or overwrite it.

## Uninstalling

```powershell
dsh plugin --profile web remove dsh-setting-manager
```

After uninstalling:

- the right-click check menu and the `/api/setting-manager` route disappear;
- the state file is not removed automatically; back it up first if needed,
  then delete it manually (profiles that share this plugin share the same
  state file, so deleting it affects all of them).

## Related documentation

- [README (中文)](../README.md) · [README (English)](./README.en.md)
