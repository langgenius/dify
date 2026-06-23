/**
 * E2E: difyctl export studio-app — DSL export
 *
 * Prerequisites (DIFY_E2E_* env vars):
 *   DIFY_E2E_WORKFLOW_APP_ID — echo-workflow app (no model provider dependency)
 *   DIFY_E2E_CHAT_APP_ID    — echo-chat app
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  assertExitCode,
} from '../../helpers/assert.js'
import { run, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

describe('E2E / difyctl export studio-app', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── Basic export ──────────────────────────────────────────────────────────

  it('[P0] exported DSL is non-empty YAML printed to stdout', async () => {
    const result = await fx.r(['export', 'studio-app', E.workflowAppId])
    assertExitCode(result, 0)
    expect(result.stdout.trim().length).toBeGreaterThan(0)
  })

  it('[P0] exported YAML contains kind: app', async () => {
    const result = await fx.r(['export', 'studio-app', E.workflowAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/^kind:\s*app/m)
  })

  it('[P0] exported YAML contains version field', async () => {
    const result = await fx.r(['export', 'studio-app', E.workflowAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/^version:/m)
  })

  it('[P0] exported YAML contains app section with mode', async () => {
    const result = await fx.r(['export', 'studio-app', E.workflowAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/^\s+mode:/m)
  })

  it('[P1] exported YAML ends with a newline (POSIX pipe convention)', async () => {
    const result = await fx.r(['export', 'studio-app', E.workflowAppId])
    assertExitCode(result, 0)
    expect(result.stdout.endsWith('\n')).toBe(true)
  })

  it('[P1] chat app export also succeeds and includes mode', async () => {
    const result = await fx.r(['export', 'studio-app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/^kind:\s*app/m)
    expect(result.stdout).toMatch(/^\s+mode:/m)
  })

  // ── --output flag ─────────────────────────────────────────────────────────

  it('[P1] --output writes DSL to file and exits 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-export-'))
    const outPath = join(dir, 'exported.yaml')
    try {
      const result = await fx.r(['export', 'studio-app', E.workflowAppId, '--output', outPath])
      assertExitCode(result, 0)
      const content = await readFile(outPath, 'utf8')
      expect(content).toMatch(/^kind:\s*app/m)
      expect(content).toMatch(/^version:/m)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('[P1] --output writes same content as stdout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-export-cmp-'))
    const outPath = join(dir, 'exported.yaml')
    try {
      const [stdoutResult, fileResult] = await Promise.all([
        fx.r(['export', 'studio-app', E.workflowAppId]),
        fx.r(['export', 'studio-app', E.workflowAppId, '--output', outPath]).then(async (r) => {
          const content = await readFile(outPath, 'utf8')
          return { exitCode: r.exitCode, content }
        }),
      ])
      assertExitCode(stdoutResult, 0)
      expect(fileResult.exitCode).toBe(0)
      expect(fileResult.content.trim()).toBe(stdoutResult.stdout.trim())
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // ── Roundtrip: export → import ────────────────────────────────────────────

  it('[P1] roundtrip: exported DSL can be re-imported as a new app', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-roundtrip-'))
    const dslPath = join(dir, 'roundtrip.yaml')
    try {
      const exportResult = await fx.r(['export', 'studio-app', E.workflowAppId, '--output', dslPath])
      assertExitCode(exportResult, 0)

      const importResult = await fx.r([
        'import',
        'studio-app',
        '--from-file',
        dslPath,
        '--name',
        'e2e-export-roundtrip',
      ])
      assertExitCode(importResult, 0)

      const match = importResult.stderr.match(/app ([0-9a-f-]{36})/)
      expect(match?.[1], 'import stderr must contain the new app UUID').toBeTruthy()
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // ── Error scenarios ───────────────────────────────────────────────────────

  it('[P0] non-existent app returns exit code 1 with error in stderr', async () => {
    const result = await fx.r(['export', 'studio-app', 'nonexistent-app-id-export-e2e'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  it('[P0] unauthenticated export returns auth error (exit code 4)', async () => {
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(['export', 'studio-app', E.workflowAppId], {
        configDir: unauthTmp.configDir,
      })
      assertExitCode(result, 4)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  it('[P1] export with missing app id argument exits non-zero', async () => {
    const result = await fx.r(['export', 'studio-app'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument|required|app id/i)
  })

  it('[P1] malformed --workflow-id returns a 4xx, not a 5xx', async () => {
    const result = await fx.r(['export', 'studio-app', E.workflowAppId, '--workflow-id', 'not-a-uuid'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/http_status:\s*4\d\d/)
    expect(result.stderr).not.toMatch(/http_status:\s*5\d\d/)
  })

  it('[P1] non-existent --workflow-id returns 404, not a 5xx', async () => {
    const result = await fx.r([
      'export',
      'studio-app',
      E.workflowAppId,
      '--workflow-id',
      '00000000-0000-0000-0000-000000000000',
    ])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/http_status:\s*404/)
  })

  it('[P1] non-existent app in --output mode leaves no file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-export-nofile-'))
    const outPath = join(dir, 'should-not-exist.yaml')
    try {
      const result = await fx.r(['export', 'studio-app', 'nonexistent-app-id-nofile-e2e', '--output', outPath])
      expect(result.exitCode).not.toBe(0)
      const exists = await readFile(outPath, 'utf8').then(() => true).catch(() => false)
      expect(exists, 'output file must not be created on export failure').toBe(false)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
