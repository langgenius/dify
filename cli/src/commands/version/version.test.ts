import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as info from '@/version/info'
import * as probe from '@/version/probe'
import Version, { COMPAT_FAIL_EXIT_CODE } from './index'

function fakeReport(overrides: {
  channel?: probe.VersionReport['client']['channel']
  reachable?: boolean
  status?: probe.VersionReport['compat']['status']
} = {}): probe.VersionReport {
  return {
    client: {
      version: '0.1.0-rc.1',
      commit: '2fd7b82970abcdef',
      buildDate: '2026-05-18T00:00:00Z',
      channel: overrides.channel ?? 'stable',
      platform: 'darwin',
      arch: 'arm64',
    },
    server: overrides.reachable === false
      ? { endpoint: '', reachable: false }
      : { endpoint: 'https://cloud.dify.ai', reachable: true, version: '1.6.4', edition: 'CLOUD' },
    compat: {
      minDify: '1.6.0',
      maxDify: '1.7.0',
      status: overrides.status ?? 'compatible',
      detail: 'server 1.6.4 in [1.6.0, 1.7.0]',
    },
  }
}

describe('Version command', () => {
  beforeEach(() => {
    vi.spyOn(probe, 'runVersionProbe').mockResolvedValue(fakeReport())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits formatted text output by default with three blocks', async () => {
    const output = await new Version().run([])
    expect(output?.kind).toBe('formatted')
    if (output?.kind !== 'formatted')
      throw new Error('expected formatted output')

    const text = output.data.text()
    expect(text).toContain('Client:')
    expect(text).toContain('Server:')
    expect(text).toContain('Compatibility: ok')
  })

  it('emits the canonical envelope when -o json is passed', async () => {
    const output = await new Version().run(['-o', 'json'])
    expect(output?.kind).toBe('formatted')
    if (output?.kind !== 'formatted')
      throw new Error('expected formatted output')

    const payload = output.data.json() as probe.VersionReport
    expect(payload).toHaveProperty('client')
    expect(payload).toHaveProperty('server')
    expect(payload).toHaveProperty('compat')
    expect(payload.compat).toHaveProperty('minDify')
    expect(payload.compat).toHaveProperty('maxDify')
    expect(payload.compat).toHaveProperty('status')
    expect(payload.server.reachable).toBe(true)
  })

  it('threads -o yaml through formatted output (envelope, not text)', async () => {
    const output = await new Version().run(['-o', 'yaml'])
    expect(output?.kind).toBe('formatted')
    if (output?.kind !== 'formatted')
      throw new Error('expected formatted output')
    expect(output.format).toBe('yaml')
    // The same envelope drives json + yaml — assert the shape via the json
    // facet (stringifyOutput uses js-yaml.dump on this object).
    const payload = output.data.json() as probe.VersionReport
    expect(payload.compat.status).toBe('compatible')
    expect(payload.server.version).toBe('1.6.4')
  })

  it('--short returns a raw single-line semver output', async () => {
    const orig = info.versionInfo.version
    Object.assign(info.versionInfo, { version: '0.2.0' })
    try {
      const output = await new Version().run(['--short'])
      expect(output?.kind).toBe('raw')
      if (output?.kind !== 'raw')
        throw new Error('expected raw output')

      expect(output.data).toBe('0.2.0\n')
    }
    finally {
      Object.assign(info.versionInfo, { version: orig })
    }
  })

  it('passes skipServer=true to the probe when --client is set', async () => {
    const spy = vi.spyOn(probe, 'runVersionProbe').mockResolvedValue(fakeReport({ reachable: false, status: 'unknown' }))
    await new Version().run(['--client'])
    expect(spy).toHaveBeenCalledWith({ skipServer: true })
  })

  function stubProcessExit() {
    const impl = (() => {
      throw new Error('__exit__')
    }) as never
    return vi.spyOn(process, 'exit').mockImplementation(impl)
  }

  it('--check-compat exits with COMPAT_FAIL_EXIT_CODE when compat is unsupported', async () => {
    vi.spyOn(probe, 'runVersionProbe').mockResolvedValue(fakeReport({ status: 'unsupported' }))
    const exitSpy = stubProcessExit()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(new Version().run(['--check-compat'])).rejects.toThrow('__exit__')
    expect(exitSpy).toHaveBeenCalledWith(COMPAT_FAIL_EXIT_CODE)
    expect(stderrSpy).toHaveBeenCalled()
  })

  it('--check-compat -o json emits the JSON envelope on stdout before exiting', async () => {
    vi.spyOn(probe, 'runVersionProbe').mockResolvedValue(fakeReport({ status: 'unsupported' }))
    const exitSpy = stubProcessExit()
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(new Version().run(['--check-compat', '-o', 'json'])).rejects.toThrow('__exit__')

    // stdout must receive a parseable JSON envelope so pipelines like
    //   `difyctl version -o json --check-compat | jq` still work on failure.
    expect(stdoutSpy).toHaveBeenCalled()
    const written = stdoutSpy.mock.calls.map(c => String(c[0])).join('')
    const parsed = JSON.parse(written) as { compat: { status: string } }
    expect(parsed.compat.status).toBe('unsupported')
    expect(exitSpy).toHaveBeenCalledWith(COMPAT_FAIL_EXIT_CODE)
  })

  it('--check-compat exits 64 when compat is unknown (no server)', async () => {
    vi.spyOn(probe, 'runVersionProbe').mockResolvedValue(fakeReport({ reachable: false, status: 'unknown' }))
    const exitSpy = stubProcessExit()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(new Version().run(['--check-compat'])).rejects.toThrow('__exit__')
    expect(exitSpy).toHaveBeenCalledWith(COMPAT_FAIL_EXIT_CODE)
  })

  it('--check-compat does not exit when compat is compatible', async () => {
    const exitSpy = stubProcessExit()
    const output = await new Version().run(['--check-compat'])
    expect(exitSpy).not.toHaveBeenCalled()
    expect(output?.kind).toBe('formatted')
  })

  it('renders RC warning in text output when channel is rc', async () => {
    vi.spyOn(probe, 'runVersionProbe').mockResolvedValue(fakeReport({ channel: 'rc' }))
    const output = await new Version().run([])
    if (output?.kind !== 'formatted')
      throw new Error('expected formatted output')

    expect(output.data.text()).toContain('WARNING: This build is a rc release')
  })
})
