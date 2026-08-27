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

const posix = (p: string) => p.replace(/\\/g, '/')

const SCRIPTS_DIR = posix(fileURLToPath(new URL('.', import.meta.url))).replace(/\/$/, '')

const BUILD_SH = 'release-build.sh'

type Run = { code: number; stderr: string }

const STUB_BUN = ['#!/bin/sh', 'echo "release-guards: bun must not run" >&2', 'exit 90', ''].join(
  '\n',
)

const FAKE_MANIFEST = {
  version: '7.7.7',
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

function runScript(
  script: string,
  cliVersion?: string,
  extraEnv: Record<string, string | undefined> = {},
): Run {
  const stubDir = tempDir('difyctl-stub-bun-')
  writeFileSync(`${stubDir}/bun`, STUB_BUN)
  chmodSync(`${stubDir}/bun`, 0o755)
  try {
    const merged: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH ?? ''}`,
      CLI_VERSION: cliVersion,
      ...extraEnv,
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

function fakeCliRoot(scriptName: string): string {
  const root = tempDir('difyctl-release-guard-')
  mkdirSync(`${root}/scripts/lib`, { recursive: true })
  cpSync(`${SCRIPTS_DIR}/${scriptName}`, `${root}/scripts/${scriptName}`)
  cpSync(`${SCRIPTS_DIR}/lib/common.sh`, `${root}/scripts/lib/common.sh`)
  cpSync(`${SCRIPTS_DIR}/release-naming.mjs`, `${root}/scripts/release-naming.mjs`)
  writeFileSync(`${root}/package.json`, JSON.stringify(FAKE_MANIFEST))
  return root
}

// Always against a throwaway root: a valid bound carries the script through to
// `rm -rf "$out_dir"`, which against the real cli root deletes a developer's build.
function runInFakeRoot(extraEnv: Record<string, string | undefined>): Run {
  const root = fakeCliRoot(BUILD_SH)
  try {
    return runScript(`${root}/scripts/${BUILD_SH}`, '2.4.0', extraEnv)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('release-build.sh compat bounds', () => {
  for (const bound of ['DIFYCTL_MIN_DIFY', 'DIFYCTL_MAX_DIFY']) {
    it.each(['undefined', '1.16'])(`rejects ${bound}=%s`, (bad) => {
      const r = runInFakeRoot({ [bound]: bad })
      expect(r.code).not.toBe(0)
      expect(r.stderr).toContain(bound)
    })

    it(`falls back to the manifest when ${bound} is empty`, () => {
      const r = runInFakeRoot({ [bound]: '' })
      expect(r.stderr).not.toContain(bound)
    })
  }

  it('does not wipe dist/bin when a bound guard fires', () => {
    const root = fakeCliRoot(BUILD_SH)
    const sentinel = `${root}/dist/bin/prior-build`
    try {
      mkdirSync(`${root}/dist/bin`, { recursive: true })
      writeFileSync(sentinel, 'output from an earlier build')
      mkdirSync(`${root}/bin`, { recursive: true })
      writeFileSync(`${root}/bin/run.ts`, 'export {}\n')

      const r = runScript(`${root}/scripts/${BUILD_SH}`, '2.4.0', {
        DIFYCTL_MIN_DIFY: 'undefined',
      })
      expect(r.code).not.toBe(0)
      expect(existsSync(sentinel)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
