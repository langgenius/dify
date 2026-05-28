import { describe, expect, it } from 'vitest'
import { ENV_REGISTRY } from '../../../env/registry.js'
import { runHelpEnvironment } from './environment.js'

describe('runHelpEnvironment', () => {
  it('starts with the ENVIRONMENT VARIABLES header', () => {
    expect(runHelpEnvironment().startsWith('ENVIRONMENT VARIABLES\n\n')).toBe(true)
  })

  it('lists every var from ENV_REGISTRY with its description', () => {
    const out = runHelpEnvironment()
    for (const v of ENV_REGISTRY) {
      expect(out).toContain(v.name)
      expect(out).toContain(v.description)
    }
  })

  it('marks sensitive vars with a never-echoed notice', () => {
    const out = runHelpEnvironment()
    expect(out).toContain('(treat as secret; never echoed)')
    const sensitiveCount = ENV_REGISTRY.filter(v => v.sensitive).length
    const noticeCount = (out.match(/treat as secret/g) ?? []).length
    expect(noticeCount).toBe(sensitiveCount)
  })
})
