# dsh-web-minimal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An out-of-tree dsh bundle package at `/Users/yaohao/work/dsh-web-minimal` that serves a minimal Web surface — conversation + trajectory only — with session/workspace/settings specified from outside (URL parameters + deployment config).

**Architecture:** One npm package carrying both `dsh.bundle.patch` (a composition layer over `@deepseek-ai/dsh-base` reusing in-box web glue and a reduced browser roster) and `dsh.client` (a browser half that reads `?session=`/`?workspace=` and drives session selection through the `mainView` retention source). No Vite app: the existing `@deepseek-ai/dsh-web-frontend` dist renders whatever the roster registers.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), tsdown (two build faces: node ESM + browser closure-factory CJS), vitest (+ jsdom for one spec), `yaml` (patch composition test).

**Spec:** `docs/specs/2026-09-25-web-minimal-design.md` (same repository — read it first; it lists every kept/dropped row and the rationale).

## Global Constraints

- Work only inside `/Users/yaohao/work/dsh-web-minimal`. Never add files to `/Users/yaohao/work/deepseek-harness`.
- Node `^22.19 || >=24`; pnpm; `"type": "module"` everywhere.
- TypeScript `strict: true`; relative source imports use explicit `.ts` extensions.
- All package names referenced by patch rows are in-box (`@deepseek-ai/*`, resolved from the running dsh installation at runtime) except `dsh-web-minimal` itself.
- Package name: `dsh-web-minimal`. Plugin row id: `ui-minimal-entry`.
- Code comments in English; UI-facing failure copy supports `zh` and `en`.
- Every file ends with exactly one trailing newline.

---

### Task 1: Repository skeleton and build faces

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `src/index.ts`

**Interfaces:**
- Produces: build script `pnpm build` emitting `lib/index.js` (node ESM) and `lib/types/**/*.d.ts`. Task 5 adds the browser face (`lib/client.js`, closure-factory CJS) to `tsdown.config.ts` together with the browser half it compiles. `package.json` declares the full exports map from the start, so later tasks touch no manifest.

- [ ] **Step 1: Write `.gitignore`, `LICENSE`, and `src/index.ts`**

`.gitignore`:
```
node_modules/
lib/
```

`LICENSE`: the MIT License text with `Copyright (c) 2026 dsh-web-minimal authors`.

`src/index.ts` (host half; the loader row needs a plugin entry with no host behavior — same convention as in-box client packages' node halves):
```ts
/**
 * dsh-web-minimal node half.
 *
 * The package's substance is the bundle patch (`cordis.patch.yml`) plus the
 * browser half (`src/client/`); this module exists so the loader row has a
 * plugin entry. It provides no Host-side behavior.
 */

/** Provides no Host-side behavior. */
export function apply(): void {}
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "dsh-web-minimal",
  "description": "Out-of-tree minimal DeepSeek Harness web surface: conversation and trajectory only; session, workspace, and settings arrive from URL parameters and deployment config",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/client.js",
    "lib/types/**/*.d.ts",
    "cordis.patch.yml"
  ],
  "scripts": {
    "build": "tsdown && tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "license": "MIT",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-api-workspace-controller"
      ]
    }
  },
  "peerDependencies": {},
  "devDependencies": {}
}
```

Then install tooling and the type-only dsh dependencies (published versions track the running dsh release):
```sh
pnpm add -D tsdown typescript vitest jsdom @types/node yaml
pnpm add -D @deepseek-ai/cordis @deepseek-ai/dsh-api-session-controller @deepseek-ai/dsh-api-workspace-controller @deepseek-ai/dsh-session
```
If the `@deepseek-ai/*` packages are not on the default registry (internal registry required), configure it per the user's environment before continuing; the four packages are needed only for `tsc` typechecking.

After the installs, declare `@deepseek-ai/cordis` as a peer so a future runtime import shares the Host's instance (the publish contract for out-of-tree plugins): move the `"@deepseek-ai/cordis"` entry from `devDependencies` into `peerDependencies` **and keep a copy in `devDependencies`** — the manifest ends with both sections containing `"@deepseek-ai/cordis": "<the installed range>"`. The other three `@deepseek-ai/*` packages stay dev-only (type-only imports, erased at runtime).

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2023", "dom", "dom.iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "declarationMap": true,
    "outDir": "lib/types",
    "rootDir": "src",
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `tsdown.config.ts` (node face)**

The browser face is added in Task 5. The browser face's closure-factory wrapper (banner/intro/footer) must match the artifact contract `ClientBundleRegistration` in the harness checkout (`packages/client/modules/src/client/manifest.ts`): the bundle registers itself via `window.__ModuleLoader__.load({ id, factory })`, keeps a CJS `module.exports` body, and resolves externals through the module-table `require`.

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  dts: false,
  external: [/^@deepseek-ai\//u],
})
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 6: Build and verify the node face emits**

Run: `pnpm build`
Expected: `lib/index.js` and `lib/types/index.d.ts` exist. (`lib/client.js` does not exist yet; Task 5 adds that face.)

Run: `node -e "import('./lib/index.js').then(m => console.log(typeof m.apply))"`
Expected: prints `function`.

- [ ] **Step 7: Commit**

```sh
git add -A
git commit -m "chore: package skeleton with node and browser build faces"
```

---

### Task 2: Boot-parameter parsing (`parseBootQuery`)

**Files:**
- Create: `src/client/params.ts`
- Test: `tests/params.spec.ts`

**Interfaces:**
- Produces: `parseBootQuery(search: string): BootParams` where `BootParams = { readonly sessionId?: string; readonly workspacePath?: string }`. Task 5's apply and Task 3's navigate consume it.

- [ ] **Step 1: Write the failing test**

`tests/params.spec.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseBootQuery } from '../src/client/params.ts'

describe('parseBootQuery', () => {
  it('returns empty params for an empty query', () => {
    expect(parseBootQuery('')).toEqual({})
  })

  it('returns empty params for a question mark only', () => {
    expect(parseBootQuery('?')).toEqual({})
  })

  it('reads a session id', () => {
    expect(parseBootQuery('?session=abc-123')).toEqual({ sessionId: 'abc-123' })
  })

  it('reads a percent-encoded workspace path', () => {
    expect(parseBootQuery('?workspace=%2Ftmp%2Fmy%20proj')).toEqual({ workspacePath: '/tmp/my proj' })
  })

  it('reads both parameters together', () => {
    expect(parseBootQuery('?session=s1&workspace=%2Fw')).toEqual({ sessionId: 's1', workspacePath: '/w' })
  })

  it('ignores unknown keys', () => {
    expect(parseBootQuery('?foo=1&session=s1&bar=2')).toEqual({ sessionId: 's1' })
  })

  it('treats blank values as absent', () => {
    expect(parseBootQuery('?session=&workspace=')).toEqual({})
  })

  it('does not decode plus signs as spaces in paths', () => {
    expect(parseBootQuery('?workspace=%2Fa+b')).toEqual({ workspacePath: '/a+b' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/params.spec.ts`
Expected: FAIL — cannot resolve `../src/client/params.ts`.

- [ ] **Step 3: Write the implementation**

`src/client/params.ts`:
```ts
/**
 * Boot-parameter parsing for the minimal surface. The page reads the query
 * string once at boot; everything it honors lives here so the contract stays
 * one function wide.
 */

/** Query parameters this surface honors at boot. */
export interface BootParams {
  /** Existing Session identity from `?session=`; validated by retain at use time. */
  readonly sessionId?: string
  /** Workspace directory from `?workspace=`; validated by the Host at use time. */
  readonly workspacePath?: string
}

/**
 * Parse the boot query string. Unknown keys are ignored; blank values count
 * as absent so a templated `?session=` placeholder boots the default flow.
 * `URLSearchParams` decodes percent escapes; `+` stays literal because a
 * filesystem path is not form data.
 * @param search - the location search string (leading `?` optional).
 * @returns the recognized parameters, absent when unnamed or blank.
 */
export function parseBootQuery(search: string): BootParams {
  const query = new URLSearchParams(search)
  const sessionId = query.get('session')
  const workspacePath = query.get('workspace')
  return {
    ...(sessionId !== null && sessionId !== '' ? { sessionId } : {}),
    ...(workspacePath !== null && workspacePath !== '' ? { workspacePath } : {}),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/params.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```sh
git add src/client/params.ts tests/params.spec.ts
git commit -m "feat: boot query parameter parsing"
```

---

### Task 3: Boot navigation (`navigateSession`)

**Files:**
- Create: `src/client/navigate.ts`
- Test: `tests/navigate.spec.ts`

**Interfaces:**
- Consumes: `BootParams` from Task 2.
- Produces: `navigateSession(services: BootServices, params: BootParams): Promise<void>` and `BootServices = { readonly sessions: Pick<ClientSessions, 'refresh' | 'create' | 'retain'>; readonly workspaces: Pick<IWorkspaces, 'create' | 'initializeDefault'> }`. Task 5's apply calls `navigateSession(ctx, params)` — the client Context satisfies `BootServices` structurally through its declared injections.

- [ ] **Step 1: Write the failing test**

`tests/navigate.spec.ts`:
```ts
import { vi, describe, expect, it, beforeEach } from 'vitest'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { navigateSession } from '../src/client/navigate.ts'

function workspaceView(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    workspaceId: 'ws-1',
    path: '/w',
    title: 'w',
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeServices() {
  const services = {
    sessions: {
      refresh: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue('created-1'),
      retain: vi.fn(),
    },
    workspaces: {
      create: vi.fn().mockResolvedValue(workspaceView()),
      initializeDefault: vi.fn().mockResolvedValue(workspaceView({ workspaceId: 'ws-default', path: '/default' })),
    },
  }
  return services
}

let services: ReturnType<typeof makeServices>
beforeEach(() => {
  services = makeServices()
})

describe('navigateSession', () => {
  it('retains a named session after refreshing the catalog, creating nothing', async () => {
    await navigateSession(services, { sessionId: 'existing-7' })
    expect(services.sessions.refresh).toHaveBeenCalledOnce()
    expect(services.sessions.retain).toHaveBeenCalledWith('existing-7', { source: 'mainView' })
    expect(services.sessions.create).not.toHaveBeenCalled()
    expect(services.workspaces.create).not.toHaveBeenCalled()
    expect(services.workspaces.initializeDefault).not.toHaveBeenCalled()
  })

  it('creates the named workspace, then a session in it, then retains', async () => {
    await navigateSession(services, { workspacePath: '/w' })
    expect(services.workspaces.create).toHaveBeenCalledWith({ path: '/w' })
    expect(services.sessions.create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(services.sessions.retain).toHaveBeenCalledWith('created-1', { source: 'mainView' })
    expect(services.workspaces.initializeDefault).not.toHaveBeenCalled()
  })

  it('initializes the default workspace when no parameter names either target', async () => {
    await navigateSession(services, {})
    expect(services.workspaces.initializeDefault).toHaveBeenCalledWith({
      directoryName: 'default-workspace',
      title: 'Default Workspace',
    })
    expect(services.sessions.create).toHaveBeenCalledWith({ workspaceId: 'ws-default' })
    expect(services.sessions.retain).toHaveBeenCalledWith('created-1', { source: 'mainView' })
    expect(services.workspaces.create).not.toHaveBeenCalled()
  })

  it('throws and retains nothing when the host refuses a default workspace', async () => {
    services.workspaces.initializeDefault.mockResolvedValue(undefined)
    await expect(navigateSession(services, {})).rejects.toThrow('default workspace')
    expect(services.sessions.create).not.toHaveBeenCalled()
    expect(services.sessions.retain).not.toHaveBeenCalled()
  })

  it('propagates session-creation failure without retaining', async () => {
    services.sessions.create.mockRejectedValue(new Error('workspace attach failed'))
    await expect(navigateSession(services, { workspacePath: '/w' })).rejects.toThrow('workspace attach failed')
    expect(services.sessions.retain).not.toHaveBeenCalled()
  })

  it('propagates retain failure for an unknown named session', async () => {
    services.sessions.retain.mockImplementation(() => {
      throw new Error('sessions.retain: unknown session ghost')
    })
    await expect(navigateSession(services, { sessionId: 'ghost' })).rejects.toThrow('unknown session ghost')
    expect(services.sessions.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/navigate.spec.ts`
Expected: FAIL — cannot resolve `../src/client/navigate.ts`.

- [ ] **Step 3: Write the implementation**

`src/client/navigate.ts`:
```ts
/**
 * Boot navigation for the minimal surface. The conversation main panel
 * renders whichever Session carries a `mainView` retention, so this module's
 * whole product is one call: resolve the URL-named target (existing session,
 * URL-named workspace, or the Host default) and retain it with that source.
 * Every failure propagates to the caller's overlay; nothing is silently
 * skipped.
 */
import type { ClientSessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BootParams } from './params.ts'

/** The retention source the conversation main panel and Session UI render. */
export const MAIN_VIEW_SOURCE = 'mainView' as const

/** Services the boot navigation drives; a structural slice of the client Context. */
export interface BootServices {
  readonly sessions: Pick<ClientSessions, 'refresh' | 'create' | 'retain'>
  readonly workspaces: Pick<IWorkspaces, 'create' | 'initializeDefault'>
}

/** The default workspace the no-parameter boot creates or reuses. */
const DEFAULT_WORKSPACE = {
  directoryName: 'default-workspace',
  title: 'Default Workspace',
} as const

/**
 * Run the boot navigation for one page load.
 *
 * - `?session=<id>`: refresh the session catalog first (a valid id absent
 *   from a stale or empty list would refuse retention otherwise), then
 *   retain it. An unknown id throws from retain.
 * - `?workspace=<path>`: create or reuse that workspace (the Host resolves
 *   an existing registration idempotently), create a session in it, retain.
 * - no parameter: initialize (or reuse) the Host default workspace, create
 *   a session in it, retain.
 *
 * @param services - the session and workspace client services.
 * @param params - the parsed boot query.
 * @throws when the named session is unknown, the workspace cannot be
 *   resolved, or session creation fails; nothing is retained in those cases.
 */
export async function navigateSession(services: BootServices, params: BootParams): Promise<void> {
  if (params.sessionId !== undefined) {
    await services.sessions.refresh()
    services.sessions.retain(params.sessionId as SessionId, { source: MAIN_VIEW_SOURCE })
    return
  }
  const workspace = params.workspacePath !== undefined
    ? await services.workspaces.create({ path: params.workspacePath })
    : await services.workspaces.initializeDefault(DEFAULT_WORKSPACE)
  if (workspace === undefined) {
    throw new Error('web-minimal: the host did not return a default workspace')
  }
  const sessionId = await services.sessions.create({ workspaceId: workspace.workspaceId })
  services.sessions.retain(sessionId, { source: MAIN_VIEW_SOURCE })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/navigate.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc -p tsconfig.json`
Expected: exit 0. If `@deepseek-ai/*` types do not resolve, Task 1 Step 2's installs are missing.

- [ ] **Step 6: Commit**

```sh
git add src/client/navigate.ts tests/navigate.spec.ts
git commit -m "feat: boot navigation over session and workspace clients"
```

---

### Task 4: Boot-failure overlay (`showBootErrorOverlay`)

**Files:**
- Create: `src/client/overlay.ts`
- Test: `tests/overlay.spec.ts`

**Interfaces:**
- Produces: `showBootErrorOverlay(container: HTMLElement, message: string): void`. Task 5's apply calls it with `document.body`.

- [ ] **Step 1: Write the failing test**

`tests/overlay.spec.ts` (the `@vitest-environment jsdom` pragma must be the first line):
```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { showBootErrorOverlay } from '../src/client/overlay.ts'

describe('showBootErrorOverlay', () => {
  it('appends one alert region carrying the message', () => {
    showBootErrorOverlay(document.body, 'boom')
    const overlay = document.querySelector('[data-dsh-web-minimal-boot-error]')
    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('role')).toBe('alert')
    expect(overlay?.textContent).toBe('boom')
  })

  it('replaces the message on a second failure instead of stacking overlays', () => {
    showBootErrorOverlay(document.body, 'first')
    showBootErrorOverlay(document.body, 'second')
    const overlays = document.querySelectorAll('[data-dsh-web-minimal-boot-error]')
    expect(overlays).toHaveLength(1)
    expect(overlays[0]?.textContent).toBe('second')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/overlay.spec.ts`
Expected: FAIL — cannot resolve `../src/client/overlay.ts`.

- [ ] **Step 3: Write the implementation**

`src/client/overlay.ts`:
```ts
/**
 * Fatal boot-navigation presentation. The minimal surface registers no slot,
 * so a navigation failure is shown as a fixed alert region over whatever the
 * frame rendered (the conversation empty state); a later call updates the
 * text instead of stacking overlays.
 */

/** Marker attribute identifying the overlay; doubles as the lookup key. */
const OVERLAY_MARKER = 'data-dsh-web-minimal-boot-error'

/** Fixed presentation shared by every overlay instance. */
const OVERLAY_STYLE = 'position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:2147483647;'
  + 'padding:0.75rem 1rem;border-radius:8px;background:#3b1d1d;color:#ffd7d7;'
  + 'font:13px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.35);white-space:pre-wrap;'

/**
 * Show one fatal boot-navigation failure over the app frame.
 * @param container - the element the overlay attaches to (the document body).
 * @param message - complete, user-readable failure text; rendered verbatim.
 */
export function showBootErrorOverlay(container: HTMLElement, message: string): void {
  let overlay = container.querySelector<HTMLElement>(`[${OVERLAY_MARKER}]`)
  if (overlay === null) {
    overlay = document.createElement('div')
    overlay.setAttribute(OVERLAY_MARKER, '')
    overlay.setAttribute('role', 'alert')
    overlay.style.cssText = OVERLAY_STYLE
    container.appendChild(overlay)
  }
  overlay.textContent = message
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/overlay.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```sh
git add src/client/overlay.ts tests/overlay.spec.ts
git commit -m "feat: boot-failure alert overlay"
```

---

### Task 5: Browser half apply and client-bundle artifact gate

**Files:**
- Modify: `tsdown.config.ts` (add the browser face)
- Create: `src/client/index.ts`
- Test: `tests/client-bundle.spec.ts`

**Interfaces:**
- Consumes: `parseBootQuery` (Task 2), `navigateSession` (Task 3), `showBootErrorOverlay` (Task 4).
- Produces: the loaded browser plugin exporting `inject = ['sessions', 'workspaces']` and `apply(ctx)`. This is what the modules system materializes from the `dsh.client` manifest's `./client` export.

- [ ] **Step 1: Add the browser face to `tsdown.config.ts`**

Replace the file's contents with:

```ts
import { defineConfig } from 'tsdown'

/** Module-table keys every dynamic browser bundle resolves at boot; mirrors the shell's PLATFORM_MODULES baseline. */
const BROWSER_BASELINE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    dts: false,
    external: [/^@deepseek-ai\//u],
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    external: [...BROWSER_BASELINE],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-web-minimal", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
```

- [ ] **Step 2: Write the failing artifact test**

`tests/client-bundle.spec.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bundlePath = new URL('../lib/client.js', import.meta.url)

describe('client bundle artifact', () => {
  const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : undefined

  it('exists; run pnpm build first', () => {
    expect(bundle).toBeDefined()
  })

  it('registers through the module loader under the package id', () => {
    expect(bundle?.startsWith('window.__ModuleLoader__.load({ id: "dsh-web-minimal", factory: (require) => {'))
      .toBe(true)
    expect(bundle?.trimEnd().endsWith('return module.exports; } });')).toBe(true)
  })

  it('ships the boot navigation modules in one bundle', () => {
    expect(bundle).toContain('parseBootQuery')
    expect(bundle).toContain('navigateSession')
    expect(bundle).toContain('showBootErrorOverlay')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/client-bundle.spec.ts`
Expected: FAIL — `lib/client.js` does not exist yet (bundle undefined in the first assertion).

- [ ] **Step 4: Write the browser half**

`src/client/index.ts`:
```ts
/**
 * dsh-web-minimal browser half: read the boot query once, drive the session
 * navigation over the session/workspace clients, and surface any failure as
 * an alert overlay. The plugin registers no slots — the reduced roster's
 * conversation area renders the retained Session, and the empty state comes
 * from ui-conversation itself.
 */
import type { Context } from '@deepseek-ai/cordis'
import { navigateSession } from './navigate.ts'
import { showBootErrorOverlay } from './overlay.ts'
import { parseBootQuery } from './params.ts'

/** Services the boot navigation drives; activation waits for both clients. */
export const inject = ['sessions', 'workspaces'] as const

/**
 * Read the boot query and retain or create the URL-named Session.
 * @param ctx - client context carrying the declared `sessions` and
 *   `workspaces` services.
 */
export function apply(ctx: Context): void {
  const params = parseBootQuery(globalThis.location.search)
  const zh = globalThis.navigator?.language?.toLowerCase().startsWith('zh') ?? false
  const heading = zh ? '无法打开会话' : 'Could not open the session'
  navigateSession(ctx, params).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    showBootErrorOverlay(document.body, `${heading}\n${detail}`)
  })
}
```

- [ ] **Step 5: Build and run the artifact test to verify it passes**

Run: `pnpm build && pnpm vitest run tests/client-bundle.spec.ts`
Expected: PASS (3 tests). If the banner assertion fails, compare byte-for-byte against the `banner` string in `tsdown.config.ts`.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `pnpm exec tsc -p tsconfig.json && pnpm test`
Expected: tsc exit 0; all specs pass (params 8, navigate 6, overlay 2, client-bundle 3).

- [ ] **Step 7: Commit**

```sh
git add tsdown.config.ts src/client/index.ts tests/client-bundle.spec.ts
git commit -m "feat: browser half applies the boot navigation"
```

---

### Task 6: Composition layer (`cordis.patch.yml`)

**Files:**
- Create: `cordis.patch.yml`
- Test: `tests/patch.spec.ts`

**Interfaces:**
- Produces: the `dsh.bundle.patch` layer named in `package.json`. The spec (`docs/specs/2026-09-25-web-minimal-design.md`) owns the kept/dropped row decisions; this test locks the mechanical facts (ids, disables, preset contents) without booting a Host.

- [ ] **Step 1: Write the failing composition test**

`tests/patch.spec.ts`:
```ts
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface PatchRow {
  id?: string
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
  insert?: PatchRow[]
}

// The test reads values mechanically: stripping the `!!js` tag leaves each
// expression's source text as a plain string, so `parse` never evaluates
// JavaScript and every assertion reads a literal from the file.
const source = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const doc = parse(source.replaceAll(' !!js ', ' ')) as PatchRow[]

function row(id: string): PatchRow {
  const found = doc.find(entry => entry.id === id)
  expect(found, `row ${id}`).toBeDefined()
  return found as PatchRow
}

function inserted(id: string): PatchRow {
  const insert = doc.find(entry => Array.isArray(entry.insert))?.insert ?? []
  const found = insert.find(entry => entry.id === id)
  expect(found, `inserted row ${id}`).toBeDefined()
  return found as PatchRow
}

const DISABLED_IDS = [
  'tool-plugin-manager', 'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search',
  'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'plan-mode',
  'compaction-basic', 'command-compact', 'tool-result-pruner', 'tool-subagent-control',
  'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork', 'workflow-ptc',
  'tool-workflow', 'tool-ralph', 'agent-instructions', 'tool-todo', 'tool-web',
]

const BROWSER_IDS = [
  'modules', 'connection', 'api-remotes', 'locale', 'ui-theme', 'ui-layout', 'ui-renderer',
  'ui-session', 'resources', 'file-upload', 'ui-conversation', 'ui-chat', 'ui-tool',
  'ui-trajectory', 'ui-approval', 'ui-user-questions', 'ui-workspace', 'ui-settings',
  'ui-sidebar-right', 'ui-minimal-entry',
]

describe('cordis.patch.yml', () => {
  it('restates the system-prompt persona rows', () => {
    expect(row('system-prompt').config).toMatchObject({
      personaSuffix: 'Your working directory is {{cwd}}.',
    })
  })

  it('mounts the web glue rows with their startup expressions', () => {
    expect(inserted('web-startup')).toMatchObject({ name: '@deepseek-ai/dsh-web-app/startup' })
    const webserver = inserted('webserver')
    expect(webserver).toMatchObject({ name: '@deepseek-ai/dsh-host-webserver', inject: ['webStartup'] })
    expect(String(webserver.config?.['host'])).toContain("ctx.webStartup.host ?? '127.0.0.1'")
    expect(String(webserver.config?.['port'])).toContain('ctx.webStartup.port ?? 3080')
    expect(webserver.config).toMatchObject({
      compression: 'gzip',
      compressionLevel: 1,
      compressionThresholdBytes: 1024,
    })
    const runtime = inserted('web-runtime')
    expect(runtime).toMatchObject({ name: '@deepseek-ai/dsh-web-app', inject: ['webStartup'] })
    expect(String(runtime.config?.['openBrowser'])).toContain('ctx.webStartup.openBrowser')
    expect(runtime.config).toMatchObject({ printUrl: true, surfaceContext: true })
    expect(String(runtime.config?.['trustedHosts'])).toContain('ctx.webStartup.trustedHosts')
  })

  it('connects the browser transport through the web runtime trust snapshot', () => {
    const connection = inserted('connection')
    expect(connection).toMatchObject({ name: '@deepseek-ai/dsh-client-connection', inject: ['webRuntime'] })
    expect(String(connection.config?.['trustedHosts'])).toContain('ctx.webRuntime.trustedHosts')
  })

  it('registers this package as the minimal-entry browser row', () => {
    expect(inserted('ui-minimal-entry')).toMatchObject({ name: 'dsh-web-minimal' })
  })

  it('mounts exactly the reduced browser roster', () => {
    const insert = doc.find(entry => Array.isArray(entry.insert))?.insert ?? []
    const ids = insert.map(entry => entry.id)
    for (const id of BROWSER_IDS) expect(ids, id).toContain(id)
    for (const absent of ['ui-sidebar', 'ui-settings-general', 'ui-plugin-manager', 'ui-jobs', 'ui-plan', 'ui-goal', 'ui-attachment', 'ui-deliverables']) {
      expect(ids, absent).not.toContain(absent)
    }
  })

  it('moves the agent plane behind the minimal preset', () => {
    for (const id of DISABLED_IDS) {
      expect(row(id)).toMatchObject({ disabled: true })
    }
    expect(inserted('agent-preset-registry').config).toMatchObject({ default: 'minimal' })
  })

  it('declares the minimal preset with persona and persistent shells', () => {
    const preset = inserted('preset-minimal')
    expect(preset.name).toBe('@deepseek-ai/dsh-agent-preset')
    const plugins = (preset.config?.['plugins'] ?? []) as Array<{ id?: string }>
    const ids = plugins.map(entry => entry.id)
    for (const required of ['persona', 'persistent-shell', 'pty', 'terminal-bash', 'persistent-bash', 'terminal-pwsh', 'persistent-pwsh']) {
      expect(ids, required).toContain(required)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/patch.spec.ts`
Expected: FAIL — `cordis.patch.yml` does not exist.

- [ ] **Step 3: Write the composition layer**

`cordis.patch.yml`:
```yaml
# The dsh-web-minimal bundle patch: a reduced browser surface over dsh-base.
# Conversation and trajectory are the only product UI; the session, its
# workspace, and every setting arrive from outside — URL parameters drive the
# session selection (the ui-minimal-entry row), and deployment settings stay
# in the profile's cordis.yml because no settings UI is registered.
#
# Rows restate web-app's layer where reused; a patch replaces a targeted row's
# whole config, so each restated row carries every key it owns. All plugin
# names except dsh-web-minimal resolve from the running dsh installation.

# ── base-row restatements ───────────────────────────────────────────────────

- id: system-prompt
  config:
    personaSuffix: Your working directory is {{cwd}}.
    personaPrefix: >-
      You are a coding agent powered by the {{model}} model.

- id: tools
  config:
    # Same temporary process-wide PTC opt-in as the Web surface; unset keeps
    # the schema default (native).
    mode: !!js process.env.DSH_TOOLS_MODE

# ── host glue, transport, and the reduced browser roster ────────────────────

- insert:
    # Ordinary provider for the parsed web flags (`--host`, `--port`,
    # `--no-open`, `--trusted-host`); owned by the in-box web-app package.
    - id: web-startup
      name: '@deepseek-ai/dsh-web-app/startup'

    - id: webserver
      name: '@deepseek-ai/dsh-host-webserver'
      inject: [webStartup]
      config:
        host: !!js ctx.webStartup.host ?? '127.0.0.1'
        port: !!js ctx.webStartup.port ?? 3080
        compression: gzip
        compressionLevel: 1
        compressionThresholdBytes: 1024

    # Web glue: resolves the in-box frontend dist, mounts the static fallback
    # owner, registers the web-surface prompt section and DSH_WEB_URL, prints
    # the URL line, and opens the browser after the Loader tree settles.
    - id: web-runtime
      name: '@deepseek-ai/dsh-web-app'
      inject: [webStartup]
      config:
        openBrowser: !!js ctx.webStartup.openBrowser
        printUrl: true
        surfaceContext: true
        trustedHosts: !!js ctx.webStartup.trustedHosts

    # Workspace service plus its browser Remote: the URL contract resolves
    # `?workspace=` through the workspace-controller client.
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'

    - id: workspace-controller
      name: '@deepseek-ai/dsh-api-workspace-controller'

    # Session commands, cold reads, and live control over Typert Remote.
    - id: session-controller
      name: '@deepseek-ai/dsh-api-session-controller'

    # Configuration-surface reads and writes; ui-settings' configForms service
    # persists through this Remote.
    - id: settings-controller
      name: '@deepseek-ai/dsh-api-settings-controller'

    # Adaptive directory-picker seam: the conversation workspace flows use it.
    - id: directory-picker
      name: '@deepseek-ai/dsh-host-directory-picker-auto'

    # In-conversation chat facts: whole-log turn/step counts and the turn rail.
    - id: session-stats
      name: '@deepseek-ai/dsh-session-stats'

    - id: session-turn-outline
      name: '@deepseek-ai/dsh-session-turn-outline'

    # ── transport ─────────────────────────────────────────────────────────────

    # Dual-face: the node half scans this tree into window.__DSH_BOOT__ and
    # serves /plugins/<id>/client.js; the browser half is the module table.
    - id: modules
      name: '@deepseek-ai/dsh-client-modules'

    # Owns both ends of the web transport: node half binds the gateway to the
    # webserver under /api; browser half is the fetch/SSE client.
    - id: connection
      name: '@deepseek-ai/dsh-client-connection'
      inject: [webRuntime]
      config:
        trustedHosts: !!js ctx.webRuntime.trustedHosts

    - id: api-remotes
      name: '@deepseek-ai/dsh-api-remotes'

    # ── browser roster: conversation + trajectory and their hard injections ───

    - id: locale
      name: '@deepseek-ai/dsh-client-locale'

    - id: ui-theme
      name: '@deepseek-ai/dsh-client-ui-theme'

    - id: ui-layout
      name: '@deepseek-ai/dsh-client-ui-layout'

    - id: ui-renderer
      name: '@deepseek-ai/dsh-client-ui-renderer'

    - id: ui-session
      name: '@deepseek-ai/dsh-client-ui-session'

    - id: resources
      name: '@deepseek-ai/dsh-client-resources'

    - id: file-upload
      name: '@deepseek-ai/dsh-client-file-upload'

    - id: ui-conversation
      name: '@deepseek-ai/dsh-client-ui-conversation'

    - id: ui-chat
      name: '@deepseek-ai/dsh-client-ui-chat'

    # Tool call tree, generic fallback, and keyed business Tool views.
    - id: ui-tool
      name: '@deepseek-ai/dsh-client-ui-tool'

    - id: ui-trajectory
      name: '@deepseek-ai/dsh-client-ui-trajectory'

    # Required by the agent loop: permission approval and ask_user takeovers.
    - id: ui-approval
      name: '@deepseek-ai/dsh-client-ui-approval'

    - id: ui-user-questions
      name: '@deepseek-ai/dsh-client-ui-user-questions'

    # ui-conversation and ui-chat inject the uiWorkspace service; its browser
    # rows render into the omitted left sidebar, so no workspace panel shows.
    - id: ui-workspace
      name: '@deepseek-ai/dsh-client-ui-workspace'

    # Provides configForms for theme/locale/conversation/chat; its page
    # renders into the omitted settings navigation, so no settings UI shows.
    - id: ui-settings
      name: '@deepseek-ai/dsh-client-ui-settings'

    # ui-chat injects the sidebarRight service for in-conversation resources.
    - id: ui-sidebar-right
      name: '@deepseek-ai/dsh-client-ui-sidebar-right'

    # This package: reads ?session= / ?workspace= and drives the selection.
    - id: ui-minimal-entry
      name: 'dsh-web-minimal'

    # ── the agent plane moves behind agent presets ────────────────────────────

    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: minimal

    # The minimal agent: a complete persona plus one persistent shell, the
    # same declaration web-app ships as its minimal preset.
    - id: preset-minimal
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: minimal
        order: 3
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are a helpful software engineer assistant.
              complete: true
              includeRuntimeContext: false
          - id: persistent-shell
            name: cordis:group
            group: true
            isolate:
              terminals: true
            config:
              - id: pty
                name: '@deepseek-ai/dsh-terminal'
              - id: terminal-bash
                name: '@deepseek-ai/dsh-terminal-bash'
                disabled: !!js process.platform === 'win32'
                config:
                  timeoutMs: 300000
              - id: persistent-bash
                name: '@deepseek-ai/dsh-tool-bash-persistent'
                disabled: !!js process.platform === 'win32'
                config:
                  timeoutMs: 300000
                  description: |-
                    Run commands in a bash shell
                    * When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
                    * Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.
                    * State is persistent across command calls and discussions with the user.
                    * To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.
                    * Please avoid commands that may produce a very large amount of output.
                    * Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.
              - id: terminal-pwsh
                name: '@deepseek-ai/dsh-terminal-bash'
                disabled: !!js process.platform !== 'win32'
                config:
                  shellDialect: pwsh
                  timeoutMs: 300000
              - id: persistent-pwsh
                name: '@deepseek-ai/dsh-tool-pwsh-persistent'
                disabled: !!js process.platform !== 'win32'
                config:
                  timeoutMs: 300000
                  description: |-
                    Run commands in a PowerShell shell
                    * When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
                    * You don't have access to the internet via this tool.
                    * State is persistent across command calls and discussions with the user.
                    * Use native Windows paths (C:\...) and $env:NAME variables; this is PowerShell, not bash.
                    * Please avoid commands that may produce a very large amount of output.
                    * Please run long lived commands in the background, e.g. 'Start-Job' or start a server with Start-Process.

# ── agent-plane rows stay out of the host plane (same list as web-app) ──────

- id: tool-plugin-manager
  disabled: true

- id: tool-bash
  disabled: true

- id: tool-pwsh
  disabled: true

- id: tool-jobs
  disabled: true

- id: tool-fs
  disabled: true

- id: tool-fs-search
  disabled: true

- id: skill-filesystem
  disabled: true

- id: tool-skill
  disabled: true

- id: command-goal
  disabled: true

- id: tool-goal
  disabled: true

- id: plan-mode
  disabled: true

- id: compaction-basic
  disabled: true

- id: command-compact
  disabled: true

- id: tool-result-pruner
  disabled: true

- id: tool-subagent-control
  disabled: true

- id: tool-subagent-list-agents
  disabled: true

- id: tool-subagent
  disabled: true

- id: tool-subagent-fork
  disabled: true

- id: workflow-ptc
  disabled: true

- id: tool-workflow
  disabled: true

- id: tool-ralph
  disabled: true

- id: agent-instructions
  disabled: true

- id: tool-todo
  disabled: true

- id: tool-web
  disabled: true
```

- [ ] **Step 4: Run the composition test to verify it passes**

Run: `pnpm vitest run tests/patch.spec.ts`
Expected: PASS (7 tests). Apply the Step 1 note if any `!!js` assertion compares against a non-string parsed value.

- [ ] **Step 5: Commit**

```sh
git add cordis.patch.yml tests/patch.spec.ts
git commit -m "feat: minimal web composition layer over dsh-base"
```

---

### Task 7: README, full verification, and dual-manifest smoke checklist

**Files:**
- Create: `README.md`

**Interfaces:**
- Produces: the operator-facing contract (install, boot, URL parameters, external settings) and the manual smoke that proves the dual-manifest assumption from the spec's risk section.

- [ ] **Step 1: Write `README.md`**

```markdown
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

## URL parameters

Read once at boot; unknown parameters are ignored.

| Parameter | Meaning | Absent behavior |
| --- | --- | --- |
| `session` | Attach this existing Session id and keep it interactive. If the id is unknown, the page shows an error overlay and creates nothing. | See `workspace`. |
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

The roster omits every sidebar, settings-page, and auxiliary row. Four of the kept rows exist only
because kept rows inject their services and would otherwise stay pending forever:

| Kept row | Required by | Visible role here |
| --- | --- | --- |
| `dsh-client-file-upload` | ui-conversation (`fileUpload`) | none (upload UI row is omitted) |
| `dsh-client-ui-workspace` | ui-conversation, ui-chat (`uiWorkspace`) | none (browser rows target the omitted sidebar) |
| `dsh-client-ui-settings` | ui-theme, locale, ui-conversation, ui-chat (`configForms`) | none (page targets the omitted settings navigation) |
| `dsh-client-ui-sidebar-right` | ui-chat (`sidebarRight`) | in-conversation resource side panel |

When upgrading the Harness, re-verify these four against the kept rows' `inject` declarations; a new
plugin-level injection of an omitted service hangs that row.

## Known limitations

- The composition test (`tests/patch.spec.ts`) checks the layer mechanically; it does not boot a Host.
  Run the smoke below before relying on a new Harness release.
- Failure copy on the boot overlay is `zh`/`en` by navigator language; product UI copy comes from the
  in-box locale dictionaries.

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
```

- [ ] **Step 2: Full verification**

Run: `pnpm build && pnpm test`
Expected: build emits `lib/`; all 4 spec files pass (params 8, navigate 6, overlay 2, client-bundle 3, patch 7 = 26 tests).

Run: `git status --short`
Expected: only untracked README.md.

- [ ] **Step 3: Commit**

```sh
git add README.md
git commit -m "docs: operator contract, roster dependencies, and smoke checklist"
```

---

## Post-plan: execution notes

- The manual smoke in Task 7 is the spec's dual-manifest risk gate. If it fails, stop and fall back to the two-package layout before any further work — do not debug the loader from this repository.
- A Harness upgrade re-run: `pnpm outdated && pnpm build && pnpm test`, then the smoke checklist.
