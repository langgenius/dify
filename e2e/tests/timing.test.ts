import { appendFileSync, mkdirSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { measurePhase } from '../support/timing'

vi.mock('node:fs', () => ({ appendFileSync: vi.fn(), mkdirSync: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('phase timing', () => {
  it('preserves the result and records duration in a process-specific log and summary', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(350)
    vi.stubEnv('GITHUB_STEP_SUMMARY', '/tmp/e2e-test-summary')
    const value = { exitCode: 0 }

    expect(await measurePhase('seed', async () => value)).toBe(value)
    expect(appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining(`timings-${process.pid}.log`),
      expect.stringContaining('"durationMs":250,"status":"passed"'),
    )
    expect(appendFileSync).toHaveBeenCalledWith(
      '/tmp/e2e-test-summary',
      '- `seed`: 0.25s (passed)\n',
    )
  })

  it('records nonzero command results as failures without changing the result', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await measurePhase(
      'cucumber',
      async () => ({ exitCode: 2 }),
      (r) => r.exitCode === 0,
    )
    expect(result.exitCode).toBe(2)
    expect(appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"status":"failed"'),
    )
  })

  it('preserves the original exception even when diagnostic persistence fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(mkdirSync).mockImplementationOnce(() => {
      throw new Error('disk unavailable')
    })
    const failure = new Error('migration failed')

    await expect(
      measurePhase('migration', async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"status":"failed"'))
  })
})
