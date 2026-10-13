import { ORPCError, safe } from '@orpc/client'
import { afterEach, expect, expectTypeOf, it, vi } from 'vite-plus/test'
import { consoleClient } from './index'

vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

const input = {
  params: { skill_id: 'skill-1' },
  body: {
    operation: 'upsert_text' as const,
    path: 'SKILL.md',
    content: '# Draft',
    expected_updated_at: 1,
  },
}
const conflict = {
  code: 'skill_conflict',
  message: 'skill has been modified by another user',
  details: { current_updated_at: 2, expected_updated_at: 1, current_file_content: '# Newer draft' },
}

afterEach(() => vi.unstubAllGlobals())

it('infers operation-specific errors and validates a real HTTP conflict', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(conflict, { status: 409, headers: { 'X-Request-Id': 'request-1' } }),
      ),
  )
  const { error, isDefined } = await safe(
    consoleClient.workspaces.current.skills.bySkillId.files.patch(input),
  )

  expect(isDefined).toBe(true)
  if (!isDefined) throw new Error('Expected a declared error')
  expectTypeOf(error.code).toEqualTypeOf<'skill_conflict' | 'skill_not_found'>()
  if (error.code === 'skill_conflict') {
    expectTypeOf(error.data.details.current_updated_at).toEqualTypeOf<number>()
    expect(error.data.details.current_file_content).toBe('# Newer draft')
  }
  const cause = error.cause
  if (
    typeof cause !== 'object' ||
    cause === null ||
    !('headers' in cause) ||
    !(cause.headers instanceof Headers)
  )
    throw new Error('Expected response headers')
  expect(cause.headers.get('X-Request-Id')).toBe('request-1')
})

it('narrows the other declared error without pretending it has conflict details', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: 'skill_not_found', message: 'skill not found' }, { status: 404 }),
      ),
  )
  const { error, isDefined } = await safe(
    consoleClient.workspaces.current.skills.bySkillId.files.patch(input),
  )
  expect(isDefined).toBe(true)
  if (!isDefined || error.code !== 'skill_not_found') throw new Error('Expected not found')
  expectTypeOf(error.data).toEqualTypeOf<{ code: 'skill_not_found'; message: string }>()
})

it.each([
  { status: 400, body: conflict },
  { status: 409, body: { ...conflict, details: { current_updated_at: 'invalid' } } },
  { status: 409, body: { ...conflict, code: 'future_error' } },
])(
  'keeps undeclared or invalid error bodies as ORPCError: $status $body.code',
  async ({ status, body }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })))
    const { error, isDefined } = await safe(
      consoleClient.workspaces.current.skills.bySkillId.files.patch(input),
    )
    expect(isDefined).toBe(false)
    expect(error).toBeInstanceOf(ORPCError)
  },
)

it('does not reinterpret errors from another operation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(conflict, { status: 409 })))
  const { error, isDefined } = await safe(
    consoleClient.workspaces.current.skills.bySkillId.get({ params: input.params }),
  )
  expect(isDefined).toBe(false)
  expect(error).toBeInstanceOf(ORPCError)
})

it.each([new TypeError('offline'), new DOMException('cancelled', 'AbortError')])(
  'preserves transport errors: $name',
  async (failure) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    const { error, isDefined } = await safe(
      consoleClient.workspaces.current.skills.bySkillId.files.patch(input),
    )
    expect(isDefined).toBe(false)
    expect(error).toBe(failure)
  },
)
