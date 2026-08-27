import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

// Paths cross from node:fs into a spawned bash, which reads a backslash as an
// escape rather than a separator.
const posix = (p: string) => p.replace(/\\/g, '/')

const SCRIPTS_DIR = posix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/$/, '')

const BUILD_SH = 'release-build.sh'
const CHECKSUMS_SH = 'release-write-checksums.sh'

type Run = { code: number; stderr: string }

// `require bun` sits above the version guard in release-build.sh, so bun has to
// resolve for these tests to reach the guard at all. Stubbing it also makes a real
// cross-compile impossible: if a regression ever carried a run past the guard, it
// dies here instead of spending minutes emitting binaries.
const STUB_BUN = ['#!/bin/sh', 'echo "release-guards: bun must not run" >&2', 'exit 90', ''].join(
  '\n',
)

// Mirrors the shape release-naming.mjs and read_pkg require, with values far from
// any real release so nothing here can be confused for a shippable artifact.
const FAKE_MANIFEST = {
  version: '0.0.0-private',
  difyctl: {
    channel: 'stable',
    compat: { minDify: '2.0.0', maxDify: '2.5.0' },
    release: {
      tagPrefix: 'difyctl-v',
      binName: 'difyctl',
      checksumsSuffix: '-checksums.txt',
      targets: [{ id: 'linux-x64', bunTarget: 'bun-linux-x64', exe: false }],
    },
  },
}

function tempDir(prefix: string): string {
  return posix(mkdtempSync(join(tmpdir(), prefix)))
}

// `cliVersion` left undefined deletes the key from a copy of the parent env, rather
// than trusting the parent not to carry one. Empty string is a separate case on
// purpose: `${VAR:?}` rejects both, but a future `${VAR?}` would accept empty.
function runScript(script: string, cliVersion?: string): Run {
  const stubDir = tempDir('difyctl-stub-bun-')
  writeFileSync(`${stubDir}/bun`, STUB_BUN)
  chmodSync(`${stubDir}/bun`, 0o755)
  try {
    const merged: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      CLI_VERSION: cliVersion,
    }
    const childEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined) childEnv[key] = value
    }
    const r = spawnSync('bash', [script], { encoding: 'utf8', env: childEnv })
    return { code: r.status ?? 1, stderr: r.stderr ?? '' }
  } finally {
    rmSync(stubDir, { recursive: true, force: true })
  }
}

// A throwaway copy of the cli tree carrying only what a release script reads, so
// `cli::root` resolves inside it. The real cli/dist/bin is then unreachable from
// these tests even in the regression they exist to catch, where `rm -rf "$out_dir"`
// actually runs.
function fakeCliRoot(scriptName: string): string {
  const root = tempDir('difyctl-release-guard-')
  mkdirSync(`${root}/scripts/lib`, { recursive: true })
  cpSync(`${SCRIPTS_DIR}/${scriptName}`, `${root}/scripts/${scriptName}`)
  cpSync(`${SCRIPTS_DIR}/lib/common.sh`, `${root}/scripts/lib/common.sh`)
  cpSync(`${SCRIPTS_DIR}/release-naming.mjs`, `${root}/scripts/release-naming.mjs`)
  writeFileSync(`${root}/package.json`, JSON.stringify(FAKE_MANIFEST))
  return root
}

// Both scripts used to fall back to `package.json` `version` behind a
// `[[ "$CLI_VERSION" != "undefined" ]]` guard. That guard only ever worked because a
// *missing* field is what makes `node -p` print the literal string "undefined". The
// manifest now pins the placeholder 0.0.0-private, which satisfies a check written to
// catch absence — so with the fallback still in place an unset CLI_VERSION would have
// produced a full set of plausible difyctl-v0.0.0-private-* binaries and a matching
// checksums file, and shipped them. The fallback is deleted; these tests are what
// stops it being reintroduced.
for (const scriptName of [BUILD_SH, CHECKSUMS_SH]) {
  describe(`${scriptName} requires CLI_VERSION`, () => {
    it('dies with CLI_VERSION unset, despite the manifest carrying a placeholder version', () => {
      const r = runScript(`${SCRIPTS_DIR}/${scriptName}`)
      expect(r.code).not.toBe(0)
      expect(r.stderr).toContain('CLI_VERSION')
    })

    it('dies with CLI_VERSION set to the empty string', () => {
      const r = runScript(`${SCRIPTS_DIR}/${scriptName}`, '')
      expect(r.code).not.toBe(0)
      expect(r.stderr).toContain('CLI_VERSION')
    })
  })
}

// The complement of the two cases above: a supplied version must not be what fails.
// Proven by running against a fake root where the next step along is missing, so the
// script reaches a later, different error — no compile, and nothing real touched.
describe('release scripts accept a supplied CLI_VERSION', () => {
  it('release-build.sh reaches the entry check', () => {
    const root = fakeCliRoot(BUILD_SH)
    try {
      const r = runScript(`${root}/scripts/${BUILD_SH}`, '2.4.0')
      expect(r.code).not.toBe(0)
      expect(r.stderr).toContain('entry not found')
      expect(r.stderr).not.toContain('CLI_VERSION')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('release-write-checksums.sh reaches the binary scan', () => {
    const root = fakeCliRoot(CHECKSUMS_SH)
    try {
      mkdirSync(`${root}/dist/bin`, { recursive: true })
      const r = runScript(`${root}/scripts/${CHECKSUMS_SH}`, '2.4.0')
      expect(r.code).not.toBe(0)
      expect(r.stderr).toContain('no binaries matching')
      expect(r.stderr).not.toContain('CLI_VERSION')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// release-build.sh wipes its output directory with `rm -rf "$out_dir"`. The required
// -env check is placed above that line, so an invocation that dies on a missing
// CLI_VERSION cannot destroy an existing build. Move the check below the rm and the
// sentinel vanishes.
describe('release-build.sh guard ordering', () => {
  it('does not wipe dist/bin when the CLI_VERSION guard fires', () => {
    const root = fakeCliRoot(BUILD_SH)
    const sentinel = `${root}/dist/bin/prior-build`
    try {
      mkdirSync(`${root}/dist/bin`, { recursive: true })
      writeFileSync(sentinel, 'output from an earlier build')
      // The entry check also precedes the rm, so without an entry this would pass
      // for the wrong reason.
      mkdirSync(`${root}/bin`, { recursive: true })
      writeFileSync(`${root}/bin/run.ts`, 'export {}\n')

      const r = runScript(`${root}/scripts/${BUILD_SH}`)
      expect(r.code).not.toBe(0)
      expect(r.stderr).toContain('CLI_VERSION')
      expect(existsSync(sentinel)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
