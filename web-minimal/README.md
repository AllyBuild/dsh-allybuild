# dsh-web-minimal

A minimal out-of-tree [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web surface:
the conversation and the trajectory, nothing else. The page shows no sidebar, settings, model picker,
or session list — the session, its workspace, and every setting arrive from outside.

One npm package carries both halves:

- `dsh.bundle.patch` (`cordis.patch.yml`) — a composition over `@deepseek-ai/dsh-base` that reuses the
  in-box web glue (`@deepseek-ai/dsh-web-app`, `dsh-host-webserver`) and registers a reduced browser
  roster: conversation, chat, tool cards, trajectory, approval, user questions, and this package's
  entry row.
- `dsh.client` (`lib/client.js`) — reads the boot query and retains or creates the URL-named Session
  through the `mainView` retention source the conversation panel renders.

## Install and boot

```sh
dsh plugin --profile web-minimal add /path/to/dsh-web-minimal
dsh --profile web-minimal
```

The first command initializes the `web-minimal` profile (`@deepseek-ai/dsh-base` plus this bundle) and
links the checkout. Web flags behave as on the full Web surface: `--host`, `--port`, `--no-open`,
`--trusted-host`.

## Embed as a React component

Host systems on React 18+ embed the whole surface without an iframe integration of their own:

```sh
pnpm add dsh-web-minimal
```

```tsx
import { DshChat } from 'dsh-web-minimal/react'

<DshChat host="http://127.0.0.1:3080" sessionId="abc-123" className="chat-pane" />
```

The component frames the running dsh webserver and serializes the same boot query contract as the
page itself (`sessionId` → `?session=`, `workspacePath` → `?workspace=`; blank values count as
absent, `+` stays literal). Changing a URL-bearing prop reloads the frame, exactly like a manual
refresh. Sizing and layout belong to the host via `className`/`style`; the iframe fills the wrapper.
`buildBootUrl` is exported alongside for systems that need the URL without the frame.

## URL parameters

Read once at boot; unknown parameters are ignored.

| Parameter | Meaning | Absent behavior |
| --- | --- | --- |
| `session` | Attach this existing Session id and keep it interactive. If the id is unknown, the page shows an error overlay with a Retry link (reloading replays the URL contract) and creates nothing. | See `workspace`. |
| `workspace` | Create or reuse a workspace at this directory path, create a new Session in it, and open it. | Initialize (or reuse) the Host default workspace, then create a Session. |

Examples:

```sh
open 'http://127.0.0.1:3080/'                          # default workspace, new session
open 'http://127.0.0.1:3080/?workspace=/tmp/demo'      # named workspace, new session
open 'http://127.0.0.1:3080/?session=<id>'             # existing session
```

## External settings

No settings UI is registered. Configure the agent, model, and tool settings in the profile's
`cordis.yml` or the deployment's patch layers, as documented by the Harness. The agent plane runs
behind the shipped `minimal` agent preset (a complete persona plus one persistent shell); override
`agent-preset-registry` in your profile patch to change it.

## The minimal browser roster and its hard dependencies

The roster omits every sidebar, settings-page, and auxiliary row. Five of the kept rows exist only
because kept rows inject their services and would otherwise stay pending forever:

| Kept row | Required by | Visible role here |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-file-upload` | ui-conversation (`fileUpload`) | none (upload UI row is omitted) |
| `@deepseek-ai/dsh-client-shortcuts` | ui-layout (`shortcuts`, required since 0.1.7) | none (no shortcut chrome beyond the frame) |
| `@deepseek-ai/dsh-client-ui-workspace` | ui-conversation, ui-chat (`uiWorkspace`) | owns the main view; the boot navigation opens sessions through it |
| `@deepseek-ai/dsh-client-ui-settings` | ui-theme, locale, ui-conversation, ui-chat (`configForms`) | none (page targets the omitted settings navigation) |
| `@deepseek-ai/dsh-client-ui-sidebar-right` | ui-chat (`sidebarRight`) | in-conversation resource side panel |

When upgrading the Harness, re-verify these five against the kept rows' `inject` declarations; a new
plugin-level injection of an omitted service hangs that row — exactly what happened at 0.1.7, when
ui-layout began injecting `shortcuts` and every row pending on `layout` hung with it. The local
composition probe used to catch this: `DSH_HOME=<dir> dsh --profile web-minimal --no-open`, open the
printed URL, and read the browser console — the shell's boot audit names every pending entry and the
exact services it waits for.

## Known limitations

- The composition test (`tests/patch.spec.ts`) checks the layer mechanically; it does not boot a Host.
  Run the smoke below before relying on a new Harness release.
- Failure copy on the boot overlay is `zh`/`en` by navigator language; product UI copy comes from the
  in-box locale dictionaries.
- Under token auth, the webserver answers the first `/?token=…` load with a 303 to `./` that drops
  the whole query string, so a boot URL carrying `session`/`workspace` must be replayed after the
  auth cookie lands (or served authlessly, as platform reverse proxies do).

## Manual smoke (dual-manifest gate)

The package declares `dsh.bundle.patch` and `dsh.client` together; no in-box package does, so verify
the loader picks up both halves after installing:

1. `pnpm build` — `lib/client.js` and `lib/index.js` exist.
2. `dsh plugin --profile web-minimal add <this checkout>` — the profile manifest gains this package in
   `dsh.profile.bundles`.
3. `dsh --profile web-minimal --dump-config` — the dump contains this package's layer with the
   `ui-minimal-entry` row.
4. `dsh --profile web-minimal` — the URL line prints; the page opens to the conversation empty state.
5. `curl http://127.0.0.1:<port>/plugins/dsh-web-minimal/client.js` — the closure-factory bundle is
   served (proves the modules scan found the `dsh.client` manifest).
6. Send a message; run a shell command; switch to the Trajectory view. Refresh with `?session=<id>` —
   the same session reopens.
7. `?session=does-not-exist` — the error overlay appears, no session is created.

If step 5 finds no bundle, the loader ignored the combined manifest: fall back to two packages
(bundle + client) in this repository and install both — see the design spec's risk section.
