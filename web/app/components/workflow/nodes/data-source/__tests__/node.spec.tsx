import type { DataSourceNodeType } from '../types'
import { useQuery } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createPluginEntity } from '@/test/fixtures/plugin'
import Node from '../node'

const requests = vi.hoisted(() => ({
  manifest: vi.fn(),
  install: vi.fn(),
  catalog: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': requests.manifest,
      'rag.pipelines.datasourcePlugins.get': requests.catalog,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.install.marketplace.post': requests.install,
    }),
  }
})

const provider = createDatasourceProvider()
const data: DataSourceNodeType = {
  title: 'Datasource',
  desc: '',
  type: BlockEnum.DataSource,
  plugin_id: provider.plugin_id,
  provider_type: 'local_file',
  provider_name: provider.provider,
  datasource_name: 'local-file',
  datasource_label: 'Local File',
  datasource_parameters: {},
  datasource_configurations: {},
  plugin_unique_identifier: provider.plugin_unique_identifier,
}

// Subscribe to the pipeline catalog so invalidation must deliver fresh data.
function DatasourceCatalog() {
  const { data: providers } = useQuery(
    consoleQuery.rag.pipelines.datasourcePlugins.get.queryOptions(),
  )
  return (
    <output aria-label="Datasource catalog">
      {providers?.map((item) => item.provider).join(', ')}
    </output>
  )
}

beforeEach(() => {
  requests.manifest.mockReset().mockResolvedValue({ plugins: [] })
  requests.install.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  requests.catalog.mockReset().mockResolvedValue([])
})

it('installs the missing datasource package, hides installation and refreshes the subscribed catalog', async () => {
  const user = userEvent.setup()
  const { queryClient } = createConsoleQueryWrapper({ workspacePermissionKeys: ['plugin.install'] })
  queryClient.setQueryData(consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey(), [])
  requests.manifest.mockResolvedValueOnce({ plugins: [] }).mockResolvedValue({
    plugins: [
      createPluginEntity({
        plugin_id: provider.plugin_id,
        plugin_unique_identifier: provider.plugin_unique_identifier,
      }),
    ],
  })
  requests.install.mockImplementation(async () => {
    requests.catalog.mockResolvedValue([provider])
    return { all_installed: true, task_id: '' }
  })
  renderWorkflowComponent(
    <>
      <Node id="data-source-node" data={data} />
      <DatasourceCatalog />
    </>,
    {
      queryClient,
      initialStoreState: { dataSourceList: [] },
    },
  )

  // Settle the initial empty catalog fetch before installation can change the server response.
  await act(async () => {
    await queryClient.query(consoleQuery.rag.pipelines.datasourcePlugins.get.queryOptions())
  })
  expect(screen.getByLabelText('Datasource catalog')).toBeEmptyDOMElement()
  await user.click(
    await screen.findByRole('button', {
      name: 'workflowAgent.nodes.agent.pluginInstaller.install',
    }),
  )

  expect(requests.install).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: [provider.plugin_unique_identifier] },
  })
  await waitFor(() => expect(screen.getByLabelText('Datasource catalog')).toHaveTextContent('file'))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /pluginInstaller.install/ }),
    ).not.toBeInTheDocument(),
  )
})

it('does not offer installation without workspace install permission', () => {
  const { queryClient } = createConsoleQueryWrapper({ workspacePermissionKeys: [] })
  const pluginIds = Array.from(
    new Set(
      [data.plugin_unique_identifier, data.plugin_id, data.provider_name].filter(
        (item): item is string => Boolean(item),
      ),
    ),
  )
  // Resolve the manifest before render so query loading cannot hide a permission regression.
  queryClient.setQueryData(
    consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryKey({
      input: { body: { plugin_ids: pluginIds } },
    }),
    { plugins: [] },
  )
  renderWorkflowComponent(<Node id="data-source-node" data={data} />, {
    queryClient,
    initialStoreState: { dataSourceList: [] },
  })
  expect(screen.queryByRole('button', { name: /pluginInstaller.install/ })).not.toBeInTheDocument()
  expect(requests.install).not.toHaveBeenCalled()
})
