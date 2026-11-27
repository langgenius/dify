import type { EndpointListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { installFakeApi } from '@/test/fake-api'
import EndpointList from '../endpoint-list'
import { createPluginDetail } from './endpoint-fixture'

// boundary: The separate README surface is unrelated to endpoint settings.
vi.mock('../../readme-panel/entrance', () => ({ ReadmeEntrance: () => null }))

const detail = createPluginDetail()
const endpoint = {
  id: 'ep-1',
  name: 'Endpoint 1',
  url: 'https://api.example.com',
  enabled: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  settings: { enabled: false, count: '0', token: '' },
  tenant_id: 'tenant-1',
  plugin_id: 'test-plugin',
  expired_at: '2030-01-01T00:00:00Z',
  hook_id: 'hook-1',
  declaration: { settings: detail.declaration.endpoint?.settings ?? [], endpoints: [] },
} satisfies EndpointListItemResponse

it.each(['create', 'edit'] as const)(
  'continues a pending %s after dismissal without opening a conflicting session',
  async (action) => {
    const request = createDeferred<void>()
    const savedEndpoint = {
      ...endpoint,
      id: action === 'create' ? 'ep-2' : endpoint.id,
      name: 'Saved endpoint',
    }
    let saved = false
    const save = async () => {
      await request.promise
      saved = true
      return { success: true } as const
    }
    const fake = installFakeApi({
      console: {
        workspaces: {
          current: {
            endpoints: {
              list: {
                plugin: {
                  get: () => ({
                    endpoints: !saved
                      ? [endpoint]
                      : action === 'create'
                        ? [endpoint, savedEndpoint]
                        : [savedEndpoint],
                  }),
                },
              },
              post: save,
              byId: { patch: save },
            },
          },
        },
      },
    })
    onTestFinished(fake)
    const endpoints = fake.console.workspaces.current.endpoints
    const saveEndpoint = action === 'create' ? endpoints.post : endpoints.byId.patch
    const { queryClient: client, wrapper: Wrapper } = createConsoleQueryWrapper()
    onTestFinished(() => {
      request.resolve()
      client.clear()
    })
    const screen = await render(
      <Wrapper>
        <EndpointList detail={detail} />
      </Wrapper>,
    )
    const opener = screen.getByRole('button', {
      name:
        action === 'create'
          ? 'plugin.detailPanel.endpointModalTitle'
          : 'common.operation.edit Endpoint 1',
    })
    if (action === 'edit') await screen.getByText(endpoint.name, { exact: true }).hover()
    await opener.click()
    const dialog = screen.getByRole('dialog')
    const name = dialog.getByPlaceholder('Endpoint Name')
    await name.fill(savedEndpoint.name)
    await dialog.getByRole('button', { name: 'common.operation.save' }).click()
    await expect.element(name).toBeDisabled()

    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(opener).toHaveAttribute('aria-busy', 'true')
    await expect.element(opener).toHaveAttribute('aria-disabled', 'true')
    await expect.element(opener).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).not.toBeInTheDocument()
    expect(saveEndpoint).toHaveBeenCalledTimes(1)

    request.resolve()
    await expect.element(screen.getByText(savedEndpoint.name, { exact: true })).toBeVisible()
    const nextOpener = screen.getByRole('button', {
      name:
        action === 'create'
          ? 'plugin.detailPanel.endpointModalTitle'
          : 'common.operation.edit Saved endpoint',
    })
    await expect.element(nextOpener).not.toHaveAttribute('aria-disabled', 'true')
    if (action === 'edit') await screen.getByText(savedEndpoint.name, { exact: true }).hover()
    await nextOpener.click()
    await expect.element(dialog).toBeVisible()
  },
)
