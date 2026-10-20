import type { DataSourceNodeType } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import Node from '../node'

const mocks = vi.hoisted(() => ({
  permissions: ['plugin.install'] as string[],
  install: vi.fn(),
  refetch: vi.fn(),
  reset: vi.fn(),
}))
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({ workspacePermissionKeys: mocks.permissions }))
})
vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: () => ({ data: { plugins: [] }, isLoading: false, refetch: mocks.refetch }),
  useInstallPackageFromMarketPlace: () => ({
    mutate: mocks.install,
    isPending: false,
    reset: mocks.reset,
  }),
}))

const data: DataSourceNodeType = {
  title: 'Datasource',
  desc: '',
  type: BlockEnum.DataSource,
  plugin_id: 'plugin-id',
  provider_type: 'local_file',
  provider_name: 'file',
  datasource_name: 'local-file',
  datasource_label: 'Local File',
  datasource_parameters: {},
  datasource_configurations: {},
  plugin_unique_identifier: 'plugin-id@1.0.0',
}

beforeEach(() => {
  mocks.permissions = ['plugin.install']
  mocks.refetch.mockReset().mockResolvedValue({ data: { plugins: [] } })
  mocks.install.mockReset().mockImplementation((_id, options) => {
    void options.onSuccess({ all_installed: true })
  })
})

it('installs the missing datasource package and invalidates the datasource catalog on success', async () => {
  const user = userEvent.setup()
  const queryClient = createAccountProfileQueryClient()
  const catalogKey = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
  queryClient.setQueryData(catalogKey, [])
  renderWorkflowComponent(<Node id="data-source-node" data={data} />, {
    queryClient,
    initialStoreState: { dataSourceList: [] },
  })

  await user.click(
    screen.getByRole('button', {
      name: 'workflowAgent.nodes.agent.pluginInstaller.install',
    }),
  )

  expect(mocks.install).toHaveBeenCalledWith('plugin-id@1.0.0', expect.any(Object))
  await waitFor(() => expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(true))
  expect(mocks.refetch).toHaveBeenCalledOnce()
})

it('does not offer installation without workspace install permission', () => {
  mocks.permissions = []
  renderWorkflowComponent(<Node id="data-source-node" data={data} />, {
    initialStoreState: { dataSourceList: [] },
  })
  expect(screen.queryByRole('button', { name: /pluginInstaller.install/ })).not.toBeInTheDocument()
  expect(mocks.install).not.toHaveBeenCalled()
})
