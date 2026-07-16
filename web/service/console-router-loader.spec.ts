import { agent } from '@dify/contracts/api/console/agent/orpc.gen'
import { apps } from '@dify/contracts/api/console/apps/orpc.gen'
import { explore } from '@dify/contracts/api/console/explore/orpc.gen'
import { installedApps } from '@dify/contracts/api/console/installed-apps/orpc.gen'
import { notification } from '@dify/contracts/api/console/notification/orpc.gen'
import { tags } from '@dify/contracts/api/console/tags/orpc.gen'
import { workspaces } from '@dify/contracts/api/console/workspaces/orpc.gen'
import { contract as enterpriseContract } from '@dify/contracts/enterprise/orpc.gen'
import { describe, expect, it } from 'vitest'
import { loadConsoleContractForSegment } from './console-router-loader'

describe('loadConsoleContractForSegment', () => {
  it.each([
    ['agent', 'agent', agent],
    ['apps', 'apps', apps],
    ['explore', 'explore', explore],
    ['installedApps', 'installedApps', installedApps],
    ['notification', 'notification', notification],
    ['tags', 'tags', tags],
    ['workspaces', 'workspaces', workspaces],
  ] as const)(
    'loads the generated %s contract when generated types are usable',
    async (segment, contractKey, generatedContract) => {
      const contract = await loadConsoleContractForSegment(segment)

      expect(contract).toHaveProperty(contractKey, generatedContract)
    },
  )

  it('loads the generated enterprise contract independently', async () => {
    const contract = await loadConsoleContractForSegment('enterprise')

    expect(contract).toHaveProperty('enterprise', enterpriseContract)
  })
})
