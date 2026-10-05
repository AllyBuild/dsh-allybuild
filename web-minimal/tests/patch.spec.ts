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
  'tool-skill', 'command-goal', 'tool-goal', 'plan-mode',
  'compaction-basic', 'command-compact', 'tool-result-pruner', 'tool-subagent-control',
  'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork', 'workflow-ptc',
  'tool-workflow', 'tool-ralph', 'agent-instructions', 'tool-todo', 'tool-web',
]

const BROWSER_IDS = [
  'modules', 'connection', 'api-remotes', 'job-controller', 'locale', 'shortcuts',
  'ui-theme', 'ui-layout', 'ui-renderer', 'ui-session', 'resources', 'file-upload',
  'ui-conversation', 'ui-chat', 'ui-attachment', 'ui-tool', 'ui-trajectory',
  'ui-approval', 'ui-plan', 'ui-user-questions', 'ui-deliverables',
  'workspace-changes', 'ui-workspace', 'ui-settings', 'ui-sidebar-right',
  'ui-jobs', 'ui-goal', 'ui-minimal-entry',
]

// Preset plugins nest inside `cordis:group` members via their `config` array;
// collect ids down those group members so the required roster spans them.
function presetPluginIds(rows: PatchRow[]): string[] {
  const ids: string[] = []
  for (const entry of rows) {
    if (entry.id !== undefined) ids.push(entry.id)
    if (Array.isArray(entry.config)) ids.push(...presetPluginIds(entry.config as PatchRow[]))
  }
  return ids
}

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

  it('mounts the shortcuts service ui-layout hard-injects since 0.1.7', () => {
    expect(inserted('shortcuts')).toMatchObject({ name: '@deepseek-ai/dsh-client-shortcuts' })
  })

  it('re-enables skill discovery from platform-provided directories', () => {
    const skills = row('skill-filesystem')
    expect(skills).toMatchObject({ disabled: false })
    expect(String(skills.config?.['customSkillDirs'])).toContain('DSH_SKILL_DIRS')
  })

  it('mounts exactly the reduced browser roster', () => {
    const insert = doc.find(entry => Array.isArray(entry.insert))?.insert ?? []
    const ids = insert.map(entry => entry.id)
    for (const id of BROWSER_IDS) expect(ids, id).toContain(id)
    for (const absent of ['ui-sidebar', 'ui-settings-general', 'ui-plugin-manager']) {
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
    const plugins = (preset.config?.['plugins'] ?? []) as PatchRow[]
    const ids = presetPluginIds(plugins)
    for (const required of ['persona', 'persistent-shell', 'pty', 'terminal-bash', 'persistent-bash', 'terminal-pwsh', 'persistent-pwsh']) {
      expect(ids, required).toContain(required)
    }
  })

  it('feeds the restored UI surfaces from the preset (jobs/goal/plan)', () => {
    const preset = inserted('preset-minimal')
    const plugins = (preset.config?.['plugins'] ?? []) as PatchRow[]
    const ids = presetPluginIds(plugins)
    for (const required of ['tool-jobs', 'command-goal', 'tool-goal', 'planning', 'plan-mode']) {
      expect(ids, required).toContain(required)
    }
    // plan-mode 需要完整的 section 策略文本（上游 cordis 预设逐字一致）
    const planning = plugins.find(entry => entry.id === 'planning') as PatchRow
    const planMode = (planning.config as PatchRow[]).find(entry => entry.id === 'plan-mode') as PatchRow
    expect(String(planMode.config?.['section'])).toContain('exit_plan_mode')
  })
})
