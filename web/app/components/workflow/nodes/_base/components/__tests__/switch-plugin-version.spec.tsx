import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectLoadingButton } from '@/test/button'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginEntity } from '@/test/fixtures/plugin'
import { SwitchPluginVersion } from '../switch-plugin-version'

const api = vi.hoisted(() => ({
  detail: vi.fn<typeof consoleClient.workspaces.current.plugin.list.installations.ids.post>(),
  upgrade: vi.fn<typeof consoleClient.workspaces.current.plugin.upgrade.marketplace.post>(),
  versions: vi.fn<() => Promise<PluginVersionsResponse>>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': api.detail,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.upgrade.marketplace.post': api.upgrade,
    }),
  }
})
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  return {
    ...actual,
    marketplaceQuery: createTanstackQueryUtils(
      { ...actual.marketplaceClient, pluginVersions: api.versions },
      { path: ['marketplace'] },
    ),
  }
})
const installed = createPluginEntity()
const identifier = (version: string) => `langgenius/plugin-entity:${version}@test`
beforeEach(() => {
  api.detail.mockReset().mockResolvedValue({ plugins: [installed] })
  api.upgrade.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  api.versions.mockReset().mockResolvedValue({
    data: {
      versions: ['2.0.0', '1.0.0', '0.5.0'].map((version) => ({
        plugin_org: 'langgenius',
        plugin_name: 'plugin-entity',
        version,
        file_name: 'plugin.difypkg',
        checksum: version,
        created_at: '2026-06-01T00:00:00Z',
        unique_identifier: identifier(version),
      })),
    },
  })
})
function setup() {
  const onChange = vi.fn()
  renderWithConsoleQuery(
    <SwitchPluginVersion
      uniqueIdentifier={installed.plugin_unique_identifier}
      tooltip="Switch to a compatible version"
      onChange={onChange}
    />,
    {
      workspacePermissionKeys: ['plugin.install'],
    },
  )
  return { user: userEvent.setup(), onChange }
}
it('submits the selected package once and reports the version only after success', async () => {
  const result = createDeferred<Awaited<ReturnType<typeof api.upgrade>>>()
  api.upgrade.mockReturnValueOnce(result.promise)
  const { user, onChange } = setup()
  await user.click(await screen.findByRole('button', { name: /switchVersion 1\.0\.0/ }))
  await user.click(await screen.findByRole('menuitem', { name: /^2\.0\.0/ }))
  const dialog = await screen.findByRole('dialog')
  const confirm = within(dialog).getByRole('button', {
    name: 'workflowAgent.nodes.agent.installPlugin.install',
  })
  await user.click(confirm)
  expectLoadingButton(confirm)
  await user.click(confirm)
  expect(api.upgrade).toHaveBeenCalledExactlyOnceWith({
    body: {
      original_plugin_unique_identifier: installed.plugin_unique_identifier,
      new_plugin_unique_identifier: identifier('2.0.0'),
    },
  })
  expect(onChange).not.toHaveBeenCalled()
  await act(async () => result.resolve({ all_installed: true, task_id: '' }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(onChange).toHaveBeenCalledExactlyOnceWith('2.0.0')
})
