import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseBootQuery } from '../src/client/params.ts'
import { buildBootUrl, DshChat } from '../src/react/DshChat.tsx'

describe('buildBootUrl', () => {
  it('returns the bare host when no parameters are given', () => {
    expect(buildBootUrl('http://127.0.0.1:3080', {})).toBe('http://127.0.0.1:3080/')
  })

  it('preserves a reverse-proxy path prefix', () => {
    expect(buildBootUrl('https://gateway.example.com/dsh', { sessionId: 's1' }))
      .toBe('https://gateway.example.com/dsh?session=s1')
  })

  it('encodes a session id', () => {
    expect(buildBootUrl('http://127.0.0.1:3080', { sessionId: 'abc-123' }))
      .toBe('http://127.0.0.1:3080/?session=abc-123')
  })

  it('percent-encodes a workspace path', () => {
    expect(buildBootUrl('http://127.0.0.1:3080', { workspacePath: '/tmp/my proj' }))
      .toBe('http://127.0.0.1:3080/?workspace=%2Ftmp%2Fmy%20proj')
  })

  it('does not encode plus signs as spaces', () => {
    expect(buildBootUrl('http://127.0.0.1:3080', { workspacePath: '/a+b' }))
      .toBe('http://127.0.0.1:3080/?workspace=%2Fa%2Bb')
  })

  it('encodes both parameters together', () => {
    expect(buildBootUrl('http://127.0.0.1:3080', { sessionId: 's1', workspacePath: '/w' }))
      .toBe('http://127.0.0.1:3080/?session=s1&workspace=%2Fw')
  })

  it('treats blank values as absent', () => {
    expect(buildBootUrl('http://127.0.0.1:3080', { sessionId: '', workspacePath: '' }))
      .toBe('http://127.0.0.1:3080/')
  })

  it('round-trips through parseBootQuery', () => {
    const url = new URL(buildBootUrl('http://127.0.0.1:3080', { workspacePath: '/tmp/my proj' }))
    expect(parseBootQuery(url.search)).toEqual({ workspacePath: '/tmp/my proj' })
  })
})

describe('DshChat', () => {
  it('renders an iframe that fills its wrapper and carries the boot URL', () => {
    const markup = renderToStaticMarkup(createElement(DshChat, {
      host: 'http://127.0.0.1:3080',
      sessionId: 's1',
    }))
    expect(markup).toContain('src="http://127.0.0.1:3080/?session=s1"')
    expect(markup).toContain('width:100%')
    expect(markup).toContain('height:100%')
    expect(markup).toContain('border:none')
  })

  it('defaults the iframe title', () => {
    const markup = renderToStaticMarkup(createElement(DshChat, { host: 'http://127.0.0.1:3080' }))
    expect(markup).toContain('title="DSH chat"')
  })

  it('accepts a custom iframe title', () => {
    const markup = renderToStaticMarkup(createElement(DshChat, {
      host: 'http://127.0.0.1:3080',
      title: 'Assistant',
    }))
    expect(markup).toContain('title="Assistant"')
  })

  it('allows clipboard writes for the conversation copy buttons', () => {
    const markup = renderToStaticMarkup(createElement(DshChat, { host: 'http://127.0.0.1:3080' }))
    expect(markup).toContain('allow="clipboard-write"')
  })

  it('forwards className and style to the wrapper', () => {
    const markup = renderToStaticMarkup(createElement(DshChat, {
      host: 'http://127.0.0.1:3080',
      className: 'chat-pane',
      style: { borderRadius: 8 },
    }))
    expect(markup).toContain('class="chat-pane"')
    expect(markup).toContain('border-radius:8px')
  })
})
