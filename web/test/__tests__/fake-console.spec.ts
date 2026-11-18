import { describe, expect, it, vi } from 'vite-plus/test'
import { consoleClient } from '@/service/console'
import { consoleError, installFakeConsole } from '../console/fake-console'
import { createNetworkAccessGroupFixture } from '../console/network-access'

const groupList = {
  tenant_id: 'workspace-1',
  entitled: true,
  groups: [createNetworkAccessGroupFixture()],
}

describe('installFakeConsole', () => {
  it('answers through the real console client with contract-validated data', async () => {
    const list = vi.fn(() => groupList)
    const teardown = installFakeConsole({
      workspaces: { current: { networkAccessGroups: { get: list } } },
    })

    const result = await consoleClient.workspaces.current.networkAccessGroups.get({})

    expect(result.groups.map((group) => group.name)).toEqual(['Internal Network'])
    expect(list).toHaveBeenCalledOnce()
    teardown()
  })

  it('decodes request bodies and returns thrown errors with their status', async () => {
    const create = vi.fn(() => {
      throw consoleError('CONFLICT', 409, 'Name already exists')
    })
    const teardown = installFakeConsole({
      workspaces: { current: { networkAccessGroups: { post: create } } },
    })

    await expect(
      consoleClient.workspaces.current.networkAccessGroups.post({
        body: { name: 'Office', allowed_cidrs: ['192.0.2.0/24'] },
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Name already exists' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ name: 'Office', allowed_cidrs: ['192.0.2.0/24'] }),
      }),
    )
    teardown()
  })

  it('accepts the repeated-key arrays the browser client sends to the Python API', async () => {
    const list = vi.fn(() => ({ data: [], has_more: false, limit: 20, page: 1, total: 0 }))
    const teardown = installFakeConsole({ apps: { get: list } })

    await consoleClient.apps.get({ query: { page: 1, limit: 20, tag_ids: ['t1', 't2'] } })

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ tag_ids: ['t1', 't2'] }) }),
    )
    teardown()
  })

  it('fails the test when a handler returns data outside the contract', async () => {
    const teardown = installFakeConsole({
      workspaces: {
        current: {
          networkAccessGroups: {
            // @ts-expect-error -- deliberately violates the output schema.
            get: () => ({ tenant_id: 'workspace-1', groups: 'not-a-list' }),
          },
        },
      },
    })

    await expect(consoleClient.workspaces.current.networkAccessGroups.get({})).rejects.toThrow()
    expect(teardown).toThrow(/Output validation failed/)
  })

  it('fails the test on console requests no handler answers', async () => {
    const teardown = installFakeConsole({})

    await expect(
      consoleClient.workspaces.current.networkAccessGroups.currentIp.get({}),
    ).rejects.toThrow()
    expect(teardown).toThrow(/unhandled console request: GET .*current-ip/)
  })
})
