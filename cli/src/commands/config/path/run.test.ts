import { describe, expect, it } from 'vitest'
import { runConfigPath } from './run.js'

describe('runConfigPath', () => {
  it('joins dir and config.yml with trailing newline', () => {
    const out = runConfigPath({ dir: '/tmp/x' })
    expect(out).toBe('/tmp/x/config.yml\n')
  })

  it('handles trailing slash on dir', () => {
    const out = runConfigPath({ dir: '/tmp/x/' })
    expect(out).toBe('/tmp/x/config.yml\n')
  })
})
