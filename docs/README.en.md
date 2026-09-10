# dsh-setting-manager
[中文](../README.md) | English

A DSH plugin that hides or shows settings sections. Right-click the section
navigation on the settings page to open a check menu; click rows to toggle
sections. Hiding is purely visual (`display:none`) and does not change any
behavior. Show/hide state is persisted to `$DSH_HOME/dsh-setting-manager.json`
and shared across browsers.

| Version | 0.1.0 |
|---|---|
| Form | Pure JS (`"type": "module"`); `lib/` is the source, no build step |
| Sides | Host (loopback route) + Client (browser menu), one entry each |

## Preview
![Preview](../images/preview.png)

## What it does

- **Right-click check menu.** Right-click anywhere on the settings section
  navigation (title area included) to open the 设置菜单 ("Settings Menu")
  popup. It lists
  every settings section in order, one row each, with a check mark: `✓` means
  the section is visible, blank means hidden. Clicking a row toggles it at
  once. The menu stays open, so you can keep clicking; every click applies
  and persists immediately. It closes only when you click outside it or press
  `Escape`.
- **Show all / Hide all.** The 显示全部 / 隐藏全部 buttons at the bottom of
  the menu cover batch operations. Clicking them does not close the menu
  either.
- **All-hidden hint.** Any section can be hidden, including all of them. When
  no section is visible, the menu shows a centered 当前已全部隐藏 line (DSH
  warning color) right away; it disappears as soon as one section is restored.
  The navigation title area still right-clicks back to the menu.
- **Cross-browser persistence.** Show/hide state travels through the Host's
  loopback route and lands in `$DSH_HOME/dsh-setting-manager.json`. Multiple
  browsers and tabs share the same state; every menu open reads it back from
  the Host and reconciles it against the current sections.
- **Theme follow.** The popup's font, spacing, corner radius, shadow,
  background, checks, and hover state all use DSH theme variables
  (`--dsw-alias-*` / `--dsw-font-family` / `--dsw-elevation-*`), so light and
  dark themes follow automatically. Width adapts to content; long section
  names are not truncated.
- **Automatic re-application.** When sections are added or removed, the
  language changes, or the navigation is rebuilt, labels are re-matched and
  the hidden state is re-applied (text matching first, index alignment as
  fallback).

## Installation

```powershell
dsh plugin --profile web add github:coderHeJiyu/dsh-setting-manager
```

Install directly from the GitHub repository, pulling the latest commit of the
default branch. Prerequisites (DSH / Node.js / pnpm), verification,
from-source mount, updating, and uninstalling are covered in the
[installation guide](./installation.en.md).

## Usage

1. Open the DSH web GUI → settings page.
2. Right-click anywhere on the section navigation on the left.
3. Click rows to toggle sections; use 显示全部 / 隐藏全部 at the bottom for
   batch operations.
4. State survives page refresh and browser switches.

## State file

Location: `$DSH_HOME/dsh-setting-manager.json` (the `$DSH_HOME` environment
variable takes precedence; the default is `~/.dsh`).

```json
{
  "version": 1,
  "hidden": [
    "models"
  ]
}
```

- `hidden` is an array of section ids (the `options.id` of `settings.section`
  entries, e.g. `general` / `models` / `plugins` / `agent-presets`).
- Read fallback: a missing file, parse failure, or a non-object top level all
  yield `{ "version": 1, "hidden": [] }`; a file without `version` (old
  format) is treated as v1 and the field is added; a non-array `hidden` is
  treated as `[]`. Nothing errors out.
- Atomic write: the file is written as `dsh-setting-manager.json.tmp` first,
  then renamed over the target, so a half-written file cannot corrupt state.
  A leftover `.tmp` is overwritten by the next write.
- 2-space indent, UTF-8, no BOM.

## API and security

The Host registers `/api/setting-manager` on the `webServer` with exactly two
methods; anything else gets `405` + `Allow: GET, POST`:

```
GET  → 200  { "version": 1, "hidden": ["models"] }
POST body { "hidden": ["plugins"] } → 200  { "version": 1, "hidden": ["plugins"] }
```

Security checks (loopback peer + Host/Origin same-origin):

| Case | Response |
|---|---|
| Peer is not loopback (outside 127.0.0.0/8, `::1`, and their IPv4-mapped forms) | 403 |
| Host header is not a loopback hostname (DNS-rebinding defense) | 403 |
| `sec-fetch-site: cross-site` | 403 |
| POST with no Origin, or an Origin that is not same-origin | 403 |
| Invalid content-length / body is not valid JSON | 400 |
| Body larger than 16 KB | 413 |
| Persistence failure | 400 |

Every response carries four security headers: `cache-control: no-store`,
`x-content-type-options: nosniff`, `cross-origin-resource-policy: same-origin`,
`referrer-policy: no-referrer`. Non-string entries in `hidden` are filtered
out. An empty body is treated as `{}`, which clears the hidden list. State is
read and written only through this route; the plugin exposes no other network
entry point. If `webServer` is absent (e.g. a headless profile), nothing is
registered.

## Dependencies

- `@deepseek-ai/dsh-home-paths`, `@deepseek-ai/dsh-host-webserver`: built-in
  DSH packages provided by the profile's `node_modules`; no separate install
  needed.
- `@deepseek-ai/cordis` (`^4.0.1`): optional peer, provided by the host.
- The client side declares `@deepseek-ai/dsh-client-runtime` and
  `@deepseek-ai/dsh-client-ui-slots` under `dsh.client.inject` in
  `package.json`. The latter resolves section labels (language thunks are
  evaluated in the current language); if it cannot be resolved, a local
  implementation with identical semantics takes over.

## Project layout

```
dsh-setting-manager/
├── lib/
│   ├── index.js      # Host: registers /api/setting-manager + state file I/O
│   └── client.js     # Client: right-click menu, display:none applier, fetch sync, theme styles
├── cordis.patch.yml  # plugin registration patch (inserts id: setting-manager)
├── package.json
└── .gitignore
```

Pure JS, `lib/` checked in as-is; no tsconfig, build output, or test
framework.

Local development (with `dsh web` running): install the checkout as a
symlink (`dsh plugin --profile web add link:/path/to/checkout`); client-hmr
stat-polls the client bundle every 500 ms (default) and broadcasts changes
over SSE, so the browser re-runs the client entry without a manual refresh.

- `lib/client.js` changes: reloaded automatically (the mechanism above).
- `lib/index.js` changes: loaded by the Host at boot; restart `dsh web`.

## Known limitations

- Hiding is purely visual: hidden sections stay mounted in the React tree,
  and their keyboard shortcuts and programmatic entry points keep working
  (same stance as VS Code's Hide View).
- The state file is global per DSH home, not per profile: multiple profiles
  with this plugin installed share one hidden list.
- Right-click detection matches the navigation button texts against section
  labels (whitespace-squashed, multiset comparison). When they do not match
  (e.g. a custom section without a label), the menu does not open and the
  default right-click behavior is preserved.
- Only the `settings.section` navigation is controlled; controls inside the
  settings page itself are out of scope.
