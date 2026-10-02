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
