import type { MutationFunctionContext } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'

const clients: QueryClient[] = []
const setup = () => {
  const client = new QueryClient()
  clients.push(client)
  const invalidated = vi.spyOn(client, 'invalidateQueries')
  const context: MutationFunctionContext = { client, meta: undefined }
  const invalidatedKeys = () => invalidated.mock.calls.map(([filters]) => filters?.queryKey)
  return { client, context, invalidatedKeys }
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

describe('skill metadata policy', () => {
  const skills = consoleQuery.workspaces.current.skills
  const params = { skill_id: 'skill-1' }
  type Detail = Parameters<
    NonNullable<ReturnType<typeof skills.bySkillId.patch.mutationOptions>['onSuccess']>
  >[0]
  const detail = { id: 'skill-1', display_name: 'Renamed', tags: ['a'] } as Detail

  it('writes the returned detail instead of refetching it', async () => {
    const { client, context, invalidatedKeys } = setup()
    const detailKey = skills.bySkillId.get.queryKey({ input: { params } })

    await skills.bySkillId.patch.mutationOptions().onSuccess!(
      detail,
      { params, body: { display_name: 'Renamed', expected_updated_at: 1 } },
      undefined,
      context,
    )

    expect(client.getQueryData(detailKey)).toBe(detail)
    expect(invalidatedKeys()).not.toContainEqual(skills.bySkillId.get.key({ input: { params } }))
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        skills.bySkillId.versions.get.key({ input: { params } }),
        skills.get.key({ type: 'query' }),
      ]),
    )
    expect(invalidatedKeys()).not.toContainEqual(skills.tags.get.key())
  })

  it('refreshes the tag catalog only when tags change', async () => {
    const { context, invalidatedKeys } = setup()

    await skills.bySkillId.patch.mutationOptions().onSuccess!(
      detail,
      { params, body: { tags: ['a'], expected_updated_at: 1 } },
      undefined,
      context,
    )

    expect(invalidatedKeys()).toContainEqual(skills.tags.get.key())
  })
})

describe('member invitation policies', () => {
  it('refreshes seats, members, and the workspace pending invitations after inviting', async () => {
    const { context, invalidatedKeys } = setup()

    await consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions().onSuccess!(
      { result: 'success', tenant_id: 'workspace-1', invitation_results: [] },
      { body: { emails: ['a@example.com'], role: 'normal', language: 'en-US' } },
      undefined,
      context,
    )

    expect(invalidatedKeys()).toEqual([
      consoleQuery.features.get.queryKey(),
      consoleQuery.workspaces.current.members.get.key(),
      consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
        input: { params: { workspace_id: 'workspace-1' } },
      }),
    ])
  })

  it('refreshes the same caches after a revoke, even a failed one', async () => {
    const { context, invalidatedKeys } = setup()
    const revoke = consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.revoke.post

    await revoke.mutationOptions().onSettled!(
      undefined,
      new Error('gone'),
      { params: { workspace_id: 'workspace-1' }, body: { email: 'a@example.com' } } as Parameters<
        NonNullable<ReturnType<typeof revoke.mutationOptions>['onSettled']>
      >[2],
      undefined,
      context,
    )

    expect(invalidatedKeys()).toHaveLength(3)
    expect(invalidatedKeys()).toContainEqual(
      consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
        input: { params: { workspace_id: 'workspace-1' } },
      }),
    )
  })
})

describe('workflow publish policies', () => {
  const workflows = consoleQuery.apps.byAppId.workflows
  const params = { app_id: 'app-1' }
  const defaultMetricsKey =
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.defaultMetrics.get.key({
      type: 'query',
      input: { params: { evaluate_target_id: 'app-1', evaluate_target_type: 'apps' } },
    })

  it('refreshes evaluation metrics after a standard publish', async () => {
    const { context, invalidatedKeys } = setup()
    const publish = workflows.publish.post.mutationOptions()

    await publish.onSuccess!(
      {} as Parameters<NonNullable<typeof publish.onSuccess>>[0],
      { params, body: {} } as Parameters<NonNullable<typeof publish.onSuccess>>[1],
      undefined,
      context,
    )

    expect(invalidatedKeys()).toContainEqual(defaultMetricsKey)
  })

  it('refreshes the app, its workflow, and evaluation lists after an evaluation publish', async () => {
    const { context, invalidatedKeys } = setup()
    const publish = workflows.publish.evaluation.post.mutationOptions()

    await publish.onSuccess!(
      {} as Parameters<NonNullable<typeof publish.onSuccess>>[0],
      { params, body: {} } as Parameters<NonNullable<typeof publish.onSuccess>>[1],
      undefined,
      context,
    )

    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        workflows.publish.get.key({ input: { params } }),
        consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
        consoleQuery.apps.byAppId.triggers.get.key({ input: { params } }),
        consoleQuery.workspaces.current.availableEvaluationWorkflows.get.key(),
        defaultMetricsKey,
      ]),
    )
  })

  it('awaits the refresh after converting the workflow kind', async () => {
    const { context, invalidatedKeys } = setup()
    const convert = workflows.convertType.post.mutationOptions()

    await convert.onSuccess!(
      {} as Parameters<NonNullable<typeof convert.onSuccess>>[0],
      { params, query: { target_type: 'evaluation' } },
      undefined,
      context,
    )

    expect(invalidatedKeys()).toEqual([
      workflows.publish.get.key({ input: { params } }),
      consoleQuery.apps.byAppId.get.queryKey({ input: { params } }),
      consoleQuery.workspaces.current.availableEvaluationWorkflows.get.key(),
    ])
  })
})
