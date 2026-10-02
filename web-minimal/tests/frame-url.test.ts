import { describe, expect, it } from 'vitest'
import { bootUrl, frameUrl } from '../src/shared/frame-url.ts'

describe('frameUrl', () => {
  it('无工作区：/frame/A + rest', () => {
    expect(frameUrl('/frame', 'A', 'api/x')).toBe('/frame/A/api/x')
  })
  it('带工作区：插入 ws/{id}/ 段', () => {
    expect(frameUrl('/frame', 'A', 'api/remote.mux', 'WS1')).toBe('/frame/A/ws/WS1/api/remote.mux')
  })
  it('frameBase 尾斜杠归一', () => {
    expect(frameUrl('/frame/', 'A', 'api/x')).toBe('/frame/A/api/x')
  })
  it('rest 为空等价根路径', () => {
    expect(frameUrl('/frame', 'A', '')).toBe('/frame/A/')
  })
})

describe('bootUrl', () => {
  it('仅 token', () => {
    expect(bootUrl('/frame', 'A', { token: 'T' })).toBe('/frame/A/boot?token=T')
  })
  it('token + session + ws', () => {
    expect(bootUrl('/frame', 'A', { token: 'T', sessionId: 'S 1', workspacePath: 'W' }))
      .toBe('/frame/A/boot?token=T&session=S%201&ws=W')
  })
})
