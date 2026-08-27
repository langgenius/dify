import type { PkgManifestOverrides } from '../test/fixtures/pkg-manifest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import {
  FIXTURE_CHANNEL,
  FIXTURE_COMPAT,
  FIXTURE_TAG_PREFIX,
  FIXTURE_VERSION,
  pkgManifestEnv,
} from '../test/fixtures/pkg-manifest'

const SCRIPT = fileURLToPath(new URL('./release-naming.mjs', import.meta.url))

const PKG_ENV = pkgManifestEnv()

type RunResult = { code: number; stdout: string; stderr: string }

function exec(args: string[], pkgEnv: Record<string, string>): RunResult {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...pkgEnv },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

function run(args: string[]): RunResult {
  return exec(args, PKG_ENV)
}

// For cases that need a manifest differing from the shared one: builds a fresh
// fixture per call.
function runWith(overrides: PkgManifestOverrides, args: string[]): RunResult {
  return exec(args, pkgManifestEnv(overrides))
}

type FixtureManifest = {
  version?: string
  difyctl: { channel?: string; compat: { minDify?: string; maxDify?: string } }
}

// pkgManifestEnv's overrides fall back to the fixture defaults, so they cannot
// express an *absent* field. Rewrite the manifest it just wrote instead — the
// path stays the fixture's business, carried in the single env var it returns.
function runOnManifest(mutate: (manifest: FixtureManifest) => void, args: string[]): RunResult {
  const pkgEnv = pkgManifestEnv()
  const [pkgPath] = Object.values(pkgEnv)
  if (!pkgPath) throw new Error('pkgManifestEnv returned no manifest path')
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as FixtureManifest
  mutate(manifest)
  writeFileSync(pkgPath, JSON.stringify(manifest))
  return exec(args, pkgEnv)
}

function parseKeyValues(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

describe('release-naming compat-check', () => {
  const { minDify, maxDify } = FIXTURE_COMPAT // 2.0.0 .. 2.5.0
  const compatCheck = (difyVersion?: string) =>
    run(difyVersion === undefined ? ['compat-check'] : ['compat-check', difyVersion]).code

  it('accepts a version inside the window', () => {
    expect(compatCheck('2.3.0')).toBe(0)
  })

  it('accepts the inclusive lower bound', () => {
    expect(compatCheck(minDify)).toBe(0)
  })

  it('accepts the inclusive upper bound', () => {
    expect(compatCheck(maxDify)).toBe(0)
  })

  it('accepts a v-prefixed tag', () => {
    expect(compatCheck('v2.3.0')).toBe(0)
  })

  it('rejects a version below the lower bound', () => {
    expect(compatCheck('1.9.9')).not.toBe(0)
  })

  it('rejects a version above the upper bound', () => {
    expect(compatCheck('2.5.1')).not.toBe(0)
  })

  it('treats a prerelease of the lower bound as below it', () => {
    expect(compatCheck(`${minDify}-rc1`)).not.toBe(0)
  })

  it('ignores build metadata on the bound', () => {
    expect(compatCheck(`${maxDify}+build123`)).toBe(0)
  })

  it('ignores build metadata when out of range', () => {
    expect(compatCheck('2.5.1+build123')).not.toBe(0)
  })

  it('requires a version argument', () => {
    expect(compatCheck()).not.toBe(0)
  })

  // minDify is the only gate that stops an LTS release: it passes the X.Y.Z
  // shape gate cleanly, so without the floor main's CLI would be labelled with
  // the LTS version — a version that lies about its contents and sorts below
  // current releases in the installer's `sort -V`, so it would never be
  // selected again.
  it('rejects an LTS-shaped release below the support floor', () => {
    expect(compatCheck('1.13.9')).not.toBe(0)
  })

  it('rejects the next minor above the ceiling', () => {
    expect(compatCheck('2.6.0')).not.toBe(0)
  })
})

describe('release-naming github-env', () => {
  const DERIVED_VERSION = '2.4.0'

  it('emits every manifest field for $GITHUB_ENV, plus a composed difyctlTag', () => {
    const fields = parseKeyValues(run(['github-env', DERIVED_VERSION]).stdout)
    expect(fields).toEqual({
      version: DERIVED_VERSION,
      channel: FIXTURE_CHANNEL,
      prerelease: 'false',
      minDify: FIXTURE_COMPAT.minDify,
      maxDify: FIXTURE_COMPAT.maxDify,
      tagPrefix: FIXTURE_TAG_PREFIX,
      difyctlTag: `${FIXTURE_TAG_PREFIX}${DERIVED_VERSION}`,
    })
  })

  // The version now comes from the caller. Falling back to the manifest is the
  // exact failure this change exists to remove: it would stamp the inert
  // placeholder onto real release assets.
  it('requires a version rather than falling back to the manifest', () => {
    const { code, stdout } = run(['github-env'])
    expect(code).not.toBe(0)
    expect(stdout).not.toContain(FIXTURE_VERSION)
  })
})

describe('release-naming edge channel', () => {
  it('lists edge among channels', () => {
    expect(run(['channels']).stdout).toMatch(/^edge$/m)
  })

  it('edge-version derives <maxDify>-edge.<sha> from the compat ceiling', () => {
    expect(run(['edge-version', '2fd7b82']).stdout.trim()).toBe(
      `${FIXTURE_COMPAT.maxDify}-edge.2fd7b82`,
    )
  })

  it('edge-version accepts a 40-char sha', () => {
    const sha = '2fd7b829e1f0aaaabbbbccccddddeeeeffff0000'
    expect(run(['edge-version', sha]).stdout.trim()).toBe(`${FIXTURE_COMPAT.maxDify}-edge.${sha}`)
  })

  it('edge-version rejects a non-hex sha', () => {
    expect(run(['edge-version', 'nothex!']).code).not.toBe(0)
  })

  it('edge-version requires a sha argument', () => {
    expect(run(['edge-version']).code).not.toBe(0)
  })

  it('edge-version names the field it could not read', () => {
    const { code, stderr } = runOnManifest(
      (m) => {
        delete m.difyctl.compat.maxDify
      },
      ['edge-version', '2fd7b82'],
    )
    expect(code).not.toBe(0)
    expect(stderr).toContain('difyctl.compat.maxDify')
  })

  it('the edge version form matches a computed edge version', () => {
    expect(run(['validate-version', '0.1.0-edge.2fd7b82', 'edge']).code).toBe(0)
  })

  it('validate-version rejects an rc string under the edge channel', () => {
    expect(run(['validate-version', '0.1.0-rc.1', 'edge']).code).not.toBe(0)
  })
})

describe('release-naming derive-version', () => {
  const derive = (tag: string) => {
    const { code, stdout } = run(['derive-version', tag])
    return { code, fields: parseKeyValues(stdout) }
  }

  it.each<[string, string]>([
    ['1.16.1', '1.16.1'],
    ['v1.16.1', '1.16.1'],
    // Normalization, not a new rule, is what covers a future tag-prefix change.
    ['v1.18.0', '1.18.0'],
  ])('derives %s into version %s', (tag, version) => {
    expect(derive(tag)).toEqual({ code: 0, fields: { ok: 'true', version } })
  })

  // Real tags from this repo's history: these are the shapes Dify has actually
  // published outside plain X.Y.Z, which is why they and not invented ones.
  // `1.10.1-fix.1` is the load-bearing one — it is the only non-X.Y.Z tag that is
  // a published, non-prerelease Release, so it is the only one the `released`
  // event actually fires for. The rc/beta tags either have no Release at all
  // (`2.0.0-beta.2`) or are flagged prerelease, so they never reach the workflow.
  it.each(['1.14.0-rc1', '2.0.0-beta.1', '2.0.0-beta.2', 'v0.8.3-fix1', '1.10.1-fix.1'])(
    'skips the real tag %s and names it in the reason',
    (tag) => {
      const { code, fields } = derive(tag)
      expect(code).toBe(0)
      expect(fields.ok).toBe('false')
      expect(fields.reason).toContain(tag)
      expect(fields.version).toBeUndefined()
    },
  )

  it.each([
    '1.16.5-hotfix1',
    '1.17',
    '1.17.0.1',
    'V1.17.0', // only a lowercase v is stripped
    'vv1.17.0', // and only one of them
  ])('skips the near-miss shape %s', (tag) => {
    const { code, fields } = derive(tag)
    expect(code).toBe(0)
    expect(fields.ok).toBe('false')
    expect(fields.version).toBeUndefined()
  })

  // The shape gate never consults the compat window: a hotfix tag inside the
  // window is still not a release difyctl attaches to. This is why the workflow
  // runs the shape gate first and makes compat-check conditional on it.
  it('skips a hotfix tag that sits inside the compat window', () => {
    const insideWindow = '2.2.5-hotfix1'
    expect(run(['compat-check', insideWindow]).code).toBe(0)
    expect(derive(insideWindow).fields.ok).toBe('false')
  })

  // The whole gate-order design rests on these two not collapsing into one exit
  // code: a shape mismatch skips the run, a missing tag is an operator error.
  it('separates skip from error: a shape mismatch exits 0, a missing tag does not', () => {
    expect(run(['derive-version', '2.0.0-beta.2']).code).toBe(0)
    expect(run(['derive-version']).code).not.toBe(0)
    expect(run(['derive-version', '']).code).not.toBe(0)
  })

  // The workflow reads this output with `sed -n 's/^reason=//p'`, so a newline
  // inside the value would truncate the reason and turn its tail into a
  // fabricated key.
  it('keeps reason on a single line when the tag carries whitespace', () => {
    const { code, stdout } = run(['derive-version', '2.0.0-beta.2\ninjected=true'])
    expect(code).toBe(0)
    expect(stdout.trim().split('\n')).toHaveLength(2)
    const fields = parseKeyValues(stdout)
    expect(fields.reason).not.toContain('\n')
    expect(fields.injected).toBeUndefined()
  })
})

// Channel validity used to be checked only as a side effect of the version-form
// check, which this change deleted. `validate` now asserts the channel itself.
// Delete that assertion and cli/package.json could carry channel "stabel" while
// the manifest gate passes, with the typo surfacing much later as an
// unresolvable define inside a compiled binary.
describe('release-naming validate channel', () => {
  const validateChannel = (channel: string) => runWith({ channel }, ['validate'])

  it.each(['stable', 'alpha', 'rc', 'edge'])('accepts the %s channel', (channel) => {
    expect(validateChannel(channel).code).toBe(0)
  })

  it('rejects a typo of a real channel and names it', () => {
    const { code, stderr } = validateChannel('stabel')
    expect(code).not.toBe(0)
    expect(stderr).toContain('unknown channel: stabel')
  })

  it('rejects the removed nightly channel', () => {
    expect(validateChannel('nightly').code).not.toBe(0)
  })

  it('rejects a manifest with no channel at all', () => {
    const { code, stderr } = runOnManifest(
      (m) => {
        delete m.difyctl.channel
      },
      ['validate'],
    )
    expect(code).not.toBe(0)
    expect(stderr).toContain('unknown channel')
  })
})

// `version` is inert — nothing in the release path reads it. `validate` pins it
// so that someone who sees 0.0.0-private and "helpfully" bumps it gets a red CI
// run instead of quietly reintroducing a second version line.
// These bounds gate every release and used to live in release-validate-manifest.sh,
// which hardcoded require('./package.json') and so could never be pointed at a fixture.
// It also carried a second, weaker copy of comparePrecedence. Both are gone.
describe('release-naming validate compat bounds', () => {
  const validateCompat = (minDify: string, maxDify: string) =>
    runWith({ compat: { minDify, maxDify } }, ['validate'])

  it('accepts a well-formed window', () => {
    expect(validateCompat('1.16.0', '1.17.0').code).toBe(0)
  })

  it('accepts equal bounds', () => {
    expect(validateCompat('1.17.0', '1.17.0').code).toBe(0)
  })

  it('rejects an inverted window', () => {
    const { code, stderr } = validateCompat('1.18.0', '1.17.0')
    expect(code).not.toBe(0)
    expect(stderr).toContain('is above maxDify')
  })

  // Wildcards need no separate guard: they simply are not X.Y.Z.
  it.each(['1.x', '1.*', '1.16', '1.16.0-rc1', 'latest', ''])('rejects %s as a bound', (bad) => {
    expect(validateCompat(bad, '2.9.0').code).not.toBe(0)
    expect(validateCompat('1.0.0', bad).code).not.toBe(0)
  })

  it('names the offending bound', () => {
    expect(validateCompat('1.x', '1.17.0').stderr).toContain('difyctl.compat.minDify')
    expect(validateCompat('1.16.0', '1.x').stderr).toContain('difyctl.compat.maxDify')
  })
})

describe('release-naming validate version placeholder', () => {
  const validatePlaceholder = (version: string) => runWith({ version }, ['validate'])

  it('accepts the inert placeholder', () => {
    expect(validatePlaceholder(FIXTURE_VERSION).code).toBe(0)
  })

  // The placeholder is pinned, not form-checked: it matches no channel's form,
  // so re-adding the version check would fail the manifest gate on every run.
  it('does not form-check the placeholder against the channel', () => {
    expect(runWith({ version: FIXTURE_VERSION, channel: 'rc' }, ['validate']).code).toBe(0)
    expect(run(['validate-version', FIXTURE_VERSION, 'rc']).code).not.toBe(0)
  })

  it.each(['0.3.0', '0.0.0'])(
    'rejects %s: the placeholder drifted back into meaning',
    (version) => {
      const { code, stderr } = validatePlaceholder(version)
      expect(code).not.toBe(0)
      expect(stderr).toContain(FIXTURE_VERSION)
    },
  )

  it('rejects a manifest with no version at all', () => {
    expect(
      runOnManifest(
        (m) => {
          delete m.version
        },
        ['validate'],
      ).code,
    ).not.toBe(0)
  })
})

describe('release-naming validate-version', () => {
  it('accepts build metadata on a stable version', () => {
    expect(run(['validate-version', '1.16.1+r2', 'stable']).code).toBe(0)
  })

  it('defaults the channel to the manifest channel', () => {
    expect(run(['validate-version', '1.16.1']).code).toBe(0)
    expect(run(['validate-version', '1.17.0-rc.1']).code).not.toBe(0)
  })

  it('reads that default from the manifest rather than assuming stable', () => {
    expect(runWith({ channel: 'rc' }, ['validate-version', '1.17.0-rc.1']).code).toBe(0)
    expect(runWith({ channel: 'rc' }, ['validate-version', '1.16.1']).code).not.toBe(0)
  })

  it('rejects an alpha-suffixed version under the manifest channel', () => {
    expect(run(['validate-version', '1.16.1-alpha']).code).not.toBe(0)
  })

  it('accepts an alpha version under the alpha channel, with or without a counter', () => {
    expect(run(['validate-version', '1.16.1-alpha', 'alpha']).code).toBe(0)
    expect(run(['validate-version', '1.16.1-alpha.2', 'alpha']).code).toBe(0)
  })
})
