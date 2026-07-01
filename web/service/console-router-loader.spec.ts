import { agent } from '@dify/contracts/api/console/agent/orpc.gen'
import { apps } from '@dify/contracts/api/console/apps/orpc.gen'
import { notification } from '@dify/contracts/api/console/notification/orpc.gen'
import { tags } from '@dify/contracts/api/console/tags/orpc.gen'
import { workspaces } from '@dify/contracts/api/console/workspaces/orpc.gen'
import { describe, expect, it } from 'vitest'
import { loadConsoleContractForSegment } from './console-router-loader'

describe('loadConsoleContractForSegment', () => {
  it.each([
    ['agent', 'agent', agent],
    ['apps', 'apps', apps],
    ['notification', 'notification', notification],
    ['tags', 'tags', tags],
    ['workspaces', 'workspaces', workspaces],
  ] as const)('loads the generated %s contract when generated types are usable', async (segment, contractKey, generatedContract) => {
    const contract = await loadConsoleContractForSegment(segment)

    expect((contract as Record<string, unknown>)[contractKey]).toBe(generatedContract)
  })
})
