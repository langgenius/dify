import { describe, expect, it } from 'vite-plus/test'
import { parseRunOptions, shouldStartManagedAgentBackend } from '../scripts/run-options'

describe('E2E run options', () => {
  it('forwards Cucumber arguments without requesting seed data', () => {
    expect(parseRunOptions(['--tags', '@smoke'])).toEqual({
      forwardArgs: ['--tags', '@smoke'],
      full: false,
      headed: false,
      seed: undefined,
      seedOnly: false,
    })
  })

  it('uses the post-merge profile for the default seed command', () => {
    expect(parseRunOptions(['--seed-only'])).toMatchObject({
      forwardArgs: [],
      seed: {
        allowBlocked: false,
        dryRun: false,
        pack: 'agent-v2',
        profile: 'post-merge',
      },
      seedOnly: true,
    })
  })

  it('seeds a named profile before forwarding Cucumber arguments', () => {
    expect(parseRunOptions(['--profile', 'prepared', '--', '--tags', '@prepared'])).toMatchObject({
      forwardArgs: ['--tags', '@prepared'],
      seed: { profile: 'prepared' },
      seedOnly: false,
    })
  })

  it('rejects seed-only options when no seed was requested', () => {
    expect(() => parseRunOptions(['--allow-blocked'])).toThrow(
      'Seed options require --seed-only or --profile.',
    )
    expect(() => parseRunOptions(['--dry-run', '--profile', 'prepared'])).toThrow(
      '--dry-run requires --seed-only.',
    )
  })
})

describe('managed Agent backend selection', () => {
  it.each(['1', 'true'])('starts a managed backend for %s', (value) => {
    expect(shouldStartManagedAgentBackend({ E2E_START_AGENT_BACKEND: value })).toBe(true)
  })

  it('uses an explicitly configured backend without starting a managed one', () => {
    expect(
      shouldStartManagedAgentBackend({ E2E_AGENT_BACKEND_URL: 'http://agent.example.test' }),
    ).toBe(false)
  })

  it('rejects two Agent backend owners', () => {
    expect(() =>
      shouldStartManagedAgentBackend({
        AGENT_BACKEND_BASE_URL: 'http://agent.example.test',
        E2E_START_AGENT_BACKEND: '1',
      }),
    ).toThrow('E2E_START_AGENT_BACKEND cannot be enabled')
  })
})
