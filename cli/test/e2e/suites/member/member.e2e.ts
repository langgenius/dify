/**
 * E2E: difyctl get/create/delete/set member — Member Management
 *
 * Data lifecycle:
 *   beforeAll  — generates two random emails, invites them as test fixtures
 *   afterAll   — removes both fixtures (best-effort)
 *
 * Email format: auto_test+<timestamp>@dify.ai
 * No extra env vars required.
 *
 * JSON response shape (MemberListResponse):
 *   { page, limit, total, has_more, data: MemberResponse[] }
 *
 * MemberResponse fields:
 *   { id, name, email, role, status, avatar?, current: bool }
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
  assertNonZeroExit,
} from '../../helpers/assert.js'
import { run, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

// ── Fixture state ─────────────────────────────────────────────────────────────

let fx: AuthFixture

/** ID of the member used by get / set tests. */
let testMemberId: string

/** ID of the member reserved for the delete-success test. */
let deleteTargetId: string

const ts = Date.now()
const memberEmail = `auto_test+${ts}@dify.ai`
const deleteTargetEmail = `auto_test+${ts + 1}@dify.ai`

// ── Response type helpers ─────────────────────────────────────────────────────

type MemberItem = {
  id: string
  name: string
  email: string
  role: string
  status: string
  current?: boolean
}

type MemberListJson = {
  data: MemberItem[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  fx = await withAuthFixture(E)

  // Invite the main test member; capture member_id from response
  const createMain = await fx.r([
    'create',
    'member',
    '--email',
    memberEmail,
    '--role',
    'normal',
    '-o',
    'json',
  ])
  if (createMain.exitCode !== 0) {
    throw new Error(
      `beforeAll: failed to create test member (${memberEmail}): ${createMain.stderr}`,
    )
  }
  const mainData = JSON.parse(createMain.stdout.trim()) as { member_id?: string }
  testMemberId = mainData.member_id as string
  if (!testMemberId)
    throw new Error(`beforeAll: missing member_id in: ${createMain.stdout}`)

  // Invite the delete-target member
  const createTarget = await fx.r([
    'create',
    'member',
    '--email',
    deleteTargetEmail,
    '--role',
    'normal',
    '-o',
    'json',
  ])
  if (createTarget.exitCode !== 0) {
    throw new Error(
      `beforeAll: failed to create delete-target member (${deleteTargetEmail}): ${createTarget.stderr}`,
    )
  }
  const targetData = JSON.parse(createTarget.stdout.trim()) as { member_id?: string }
  deleteTargetId = targetData.member_id as string
  if (!deleteTargetId)
    throw new Error(`beforeAll: missing member_id in: ${createTarget.stdout}`)
})

afterAll(async () => {
  if (testMemberId) {
    await fx.r(['delete', 'member', testMemberId, '--yes']).catch(() => {})
  }
  if (deleteTargetId) {
    await fx.r(['delete', 'member', deleteTargetId, '--yes']).catch(() => {})
  }
  await fx.cleanup()
})

// ── get member ────────────────────────────────────────────────────────────────

describe('E2E / difyctl get member', () => {
  it('[P0] member list contains the created test member', async () => {
    const result = await fx.r(['get', 'member', '-o', 'json'])
    assertExitCode(result, 0)
    const data = assertJson<MemberListJson>(result)
    const ids = (data.data ?? []).map(m => m.id)
    expect(ids, `testMemberId ${testMemberId} must appear in member list`).toContain(testMemberId)
  })

  it('[P0] default table output contains required column headers', async () => {
    const result = await fx.r(['get', 'member'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/\bID\b/)
    expect(result.stdout).toMatch(/\bNAME\b/)
    expect(result.stdout).toMatch(/\bEMAIL\b/)
    expect(result.stdout).toMatch(/\bROLE\b/)
    expect(result.stdout).toMatch(/\bSTATUS\b/)
  })

  it('[P0] authenticated account appears in member list', async () => {
    // The token owner (auto_test@dify.ai) must appear in the member list
    const result = await fx.r(['get', 'member', '-o', 'json'])
    assertExitCode(result, 0)
    const data = assertJson<MemberListJson>(result)
    const ownerRow = data.data.find(m => m.email === E.email)
    expect(ownerRow, `owner email ${E.email} must be in member list`).toBeDefined()
    expect(ownerRow?.role).toBe('owner')
    expect(ownerRow?.status).toBe('active')
  })

  it('[P0] -o json returns valid JSON with data array', async () => {
    const result = await fx.r(['get', 'member', '-o', 'json'])
    assertExitCode(result, 0)
    const data = assertJson<MemberListJson>(result)
    expect(Array.isArray(data.data), 'data must be an array').toBe(true)
    expect(data.data.length).toBeGreaterThan(0)
  })

  it('[P0] -o json each member has id, email, role, status fields', async () => {
    const result = await fx.r(['get', 'member', '-o', 'json'])
    assertExitCode(result, 0)
    const data = assertJson<MemberListJson>(result)
    const member = data.data[0]!
    expect(typeof member.id).toBe('string')
    expect(typeof member.email).toBe('string')
    expect(typeof member.role).toBe('string')
    expect(typeof member.status).toBe('string')
  })

  it('[P0] output has no ANSI colour codes (non-TTY)', async () => {
    const result = await fx.r(['get', 'member'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })

  it('[P0] unauthenticated get member returns auth error (exit code 4)', async () => {
    const tmp = await withTempConfig()
    try {
      const result = await run(['get', 'member'], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth.?login/i)
    }
    finally {
      await tmp.cleanup()
    }
  })

  it('[P1] -o yaml returns valid YAML (non-empty, no JSON braces)', async () => {
    const result = await fx.r(['get', 'member', '-o', 'yaml'])
    assertExitCode(result, 0)
    expect(result.stdout.trim().length).toBeGreaterThan(0)
    expect(result.stdout.trimStart()).not.toMatch(/^\{/)
  })

  it('[P1] -o json output is pipe-friendly (no ANSI, ends with newline)', async () => {
    const result = await fx.r(['get', 'member', '-o', 'json'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
    expect(result.stdout.endsWith('\n')).toBe(true)
  })

  it('[P1] -w overrides the workspace', async () => {
    const result = await fx.r(['get', 'member', '-w', E.workspaceId, '-o', 'json'])
    assertExitCode(result, 0)
    const data = assertJson<MemberListJson>(result)
    expect(Array.isArray(data.data)).toBe(true)
  })
})

// ── set member ────────────────────────────────────────────────────────────────

describe('E2E / difyctl set member', () => {
  it('[P0] owner/admin can promote normal → admin', async () => {
    const result = await fx.r(['set', 'member', testMemberId, '--role', 'admin', '-o', 'json'])
    assertExitCode(result, 0)
    const list = await fx.r(['get', 'member', '-o', 'json'])
    const data = assertJson<MemberListJson>(list)
    const updated = data.data.find(m => m.id === testMemberId)
    expect(updated?.role).toBe('admin')
  })

  it('[P0] owner/admin can demote admin → normal', async () => {
    await fx.r(['set', 'member', testMemberId, '--role', 'admin'])
    const result = await fx.r(['set', 'member', testMemberId, '--role', 'normal', '-o', 'json'])
    assertExitCode(result, 0)
    const list = await fx.r(['get', 'member', '-o', 'json'])
    const data = assertJson<MemberListJson>(list)
    const updated = data.data.find(m => m.id === testMemberId)
    expect(updated?.role).toBe('normal')
  })

  it('[P0] --role owner is rejected client-side (exit 2, no API call)', async () => {
    const result = await fx.r(['set', 'member', testMemberId, '--role', 'owner'])
    assertExitCode(result, 2)
    expect(result.stderr).toMatch(/invalid|role|owner/i)
  })

  it('[P0] missing --role returns usage error', async () => {
    const result = await fx.r(['set', 'member', testMemberId])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/role|required|missing/i)
  })

  it('[P0] unauthenticated set member returns auth error (exit 4)', async () => {
    const tmp = await withTempConfig()
    try {
      const result = await run(['set', 'member', testMemberId, '--role', 'normal'], {
        configDir: tmp.configDir,
      })
      assertExitCode(result, 4)
    }
    finally {
      await tmp.cleanup()
    }
  })

  it('[P1] missing member-id returns usage error', async () => {
    const result = await fx.r(['set', 'member', '--role', 'normal'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing|required|arg|member/i)
  })

  it('[P1] non-existent member-id returns server error', async () => {
    const result = await fx.r([
      'set',
      'member',
      '00000000-0000-0000-0000-000000000000',
      '--role',
      'normal',
    ])
    assertNonZeroExit(result)
    expect(result.stderr.trim().length).toBeGreaterThan(0)
  })
})

// ── create member — error paths ───────────────────────────────────────────────

describe('E2E / difyctl create member (error paths)', () => {
  it('[P0] --role with invalid value is rejected client-side (exit 2)', async () => {
    const result = await fx.r([
      'create',
      'member',
      '--email',
      `auto_test+unused${Date.now()}@dify.ai`,
      '--role',
      'superadmin',
    ])
    assertExitCode(result, 2)
    expect(result.stderr).toMatch(/invalid|role/i)
  })

  it('[P0] --role owner is rejected client-side (exit 2)', async () => {
    const result = await fx.r([
      'create',
      'member',
      '--email',
      `auto_test+unused${Date.now()}@dify.ai`,
      '--role',
      'owner',
    ])
    assertExitCode(result, 2)
    expect(result.stderr).toMatch(/invalid|role|owner/i)
  })

  it('[P0] missing --email returns usage error', async () => {
    const result = await fx.r(['create', 'member', '--role', 'normal'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/email|required|missing/i)
  })

  it('[P0] missing --role returns usage error', async () => {
    const result = await fx.r(['create', 'member', '--email', memberEmail])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/role|required|missing/i)
  })

  it('[P0] unauthenticated create member returns auth error (exit 4)', async () => {
    const tmp = await withTempConfig()
    try {
      const result = await run(
        ['create', 'member', '--email', `auto_test+unauth${Date.now()}@dify.ai`, '--role', 'normal'],
        { configDir: tmp.configDir },
      )
      assertExitCode(result, 4)
    }
    finally {
      await tmp.cleanup()
    }
  })
})

// ── delete member ─────────────────────────────────────────────────────────────

describe('E2E / difyctl delete member', () => {
  it('[P0] owner/admin can remove a member from the workspace', async () => {
    const result = await fx.r(['delete', 'member', deleteTargetId, '--yes'])
    assertExitCode(result, 0)
    const list = await fx.r(['get', 'member', '-o', 'json'])
    const data = assertJson<MemberListJson>(list)
    const ids = data.data.map(m => m.id)
    expect(ids).not.toContain(deleteTargetId)
    deleteTargetId = ''
  })

  it('[P0] attempting to delete self returns server error', async () => {
    const list = await fx.r(['get', 'member', '-o', 'json'])
    const data = assertJson<MemberListJson>(list)
    const self = data.data.find(m => m.email === E.email)
    if (!self) {
      console.warn('[E2E] could not identify self in member list — skipping')
      return
    }
    const result = await fx.r(['delete', 'member', self.id, '--yes'])
    assertNonZeroExit(result)
    expect(result.stderr).toMatch(/self|yourself|cannot|not.*allow|400|forbidden/i)
  })

  it('[P0] missing member-id argument returns usage error', async () => {
    const result = await fx.r(['delete', 'member'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing|required|arg|member/i)
  })

  it('[P0] unauthenticated delete member returns auth error (exit 4)', async () => {
    const tmp = await withTempConfig()
    try {
      const result = await run(
        ['delete', 'member', '00000000-0000-0000-0000-000000000000', '--yes'],
        { configDir: tmp.configDir },
      )
      assertExitCode(result, 4)
    }
    finally {
      await tmp.cleanup()
    }
  })

  it('[P1] non-existent member-id returns server error', async () => {
    const result = await fx.r([
      'delete',
      'member',
      '00000000-0000-0000-0000-000000000000',
      '--yes',
    ])
    assertNonZeroExit(result)
    expect(result.stderr.trim().length).toBeGreaterThan(0)
  })

  it('[P1] -o json outputs structured envelope on error', async () => {
    const result = await fx.r([
      'delete',
      'member',
      '00000000-0000-0000-0000-000000000000',
      '--yes',
      '-o',
      'json',
    ])
    assertNonZeroExit(result)
    assertErrorEnvelope(result)
  })
})
