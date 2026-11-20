import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import { createMcpProviderFixture } from '@/test/fixtures/mcp'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import MCPDetailPanel from '../provider-detail'

const api = vi.hoisted(() => ({
  tools: vi.fn<typeof consoleClient.workspaces.current.toolProvider.mcp.tools.byProviderId.get>(),
  update: vi.fn<typeof consoleClient.workspaces.current.toolProvider.mcp.update.byProviderId.get>(),
}))

// boundary: only the generated service responses are replaced; mutations and overlays stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProvider.mcp.tools.byProviderId.get': api.tools,
      'workspaces.current.toolProvider.mcp.update.byProviderId.get': api.update,
    }),
  }
})

const tools = createToolProviderFixture({
  id: 'mcp-1',
  type: 'mcp',
  tools: [
    {
      name: 'search',
      author: 'MCP',
      label: { en_US: 'Search' },
      description: { en_US: 'Search' },
      parameters: [],
    },
  ],
})

async function setup() {
  const { wrapper: Wrapper, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['mcp.manage'],
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.toolProvider.mcp.tools.byProviderId.get.queryKey({
      input: { params: { provider_id: 'mcp-1' } },
    }),
    tools,
  )
  const onUpdate = vi.fn()
  const onHide = vi.fn()
  const panel = (detail = createMcpProviderFixture()) => (
    <Wrapper>
      <MCPDetailPanel
        detail={detail}
        isTriggerAuthorize={false}
        onUpdate={onUpdate}
        onFirstCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onHide={onHide}
      />
    </Wrapper>
  )
  const view = await render(panel())
  await page.getByRole('button', { name: 'tools.mcp.update', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'tools.mcp.toolUpdateConfirmTitle' })
  await expect.element(dialog).toBeVisible()
  return {
    dialog,
    onUpdate,
    onHide,
    queryClient,
    rerender: (detail: ReturnType<typeof createMcpProviderFixture>) => view.rerender(panel(detail)),
  }
}

beforeEach(() => {
  api.tools.mockReset().mockResolvedValue(tools)
  api.update.mockReset().mockResolvedValue(tools)
  onTestFinished(guardUnexpectedFetch())
})

it('protects the pending update and closes only after success', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.update>>>()
  api.update.mockReturnValueOnce(pending.promise)
  const { dialog, onUpdate, onHide } = await setup()
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  await expect.element(confirm).toHaveAttribute('aria-disabled', 'true')
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
    .toBeDisabled()
  expect(api.update).toHaveBeenCalledExactlyOnceWith({ params: { provider_id: 'mcp-1' } })
  expect(onUpdate).not.toHaveBeenCalled()
  expect(onHide).not.toHaveBeenCalled()

  pending.resolve(tools)
  await expect.element(dialog).not.toBeInTheDocument()
  expect(onUpdate).toHaveBeenCalledOnce()
  await expect
    .element(page.getByRole('button', { name: 'tools.mcp.update', exact: true }))
    .toHaveFocus()
})

it('closes on success while tools refetch and returns focus to the stable drawer close button', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.tools>>>()
  api.tools.mockReturnValueOnce(pending.promise)
  const { dialog } = await setup()
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
  expect(api.tools).toHaveBeenCalledOnce()
  pending.resolve(tools)
  await expect
    .element(page.getByRole('button', { name: 'tools.mcp.update', exact: true }))
    .toBeVisible()
})

it('keeps a rejected update open for retry without an unhandled rejection', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.update>>>()
  api.update.mockReturnValueOnce(pending.promise)
  const { dialog, onUpdate } = await setup()
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  await confirm.click()
  pending.reject(new Error('Update failed'))
  await expect.element(dialog).toBeVisible()
  await expect.element(confirm).not.toHaveAttribute('aria-disabled', 'true')
  expect(onUpdate).not.toHaveBeenCalled()
  await confirm.click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.update).toHaveBeenCalledTimes(2)
  expect(onUpdate).toHaveBeenCalledOnce()
})

it('refreshes the provider that completed updating when the parent selects another provider', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.update>>>()
  api.update.mockReturnValueOnce(pending.promise)
  const { dialog, queryClient, rerender } = await setup()
  const key = (id: string) =>
    consoleQuery.workspaces.current.toolProvider.mcp.tools.byProviderId.get.queryKey({
      input: { params: { provider_id: id } },
    })
  queryClient.setQueryData(key('mcp-2'), tools)
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await rerender(createMcpProviderFixture({ id: 'mcp-2' }))
  pending.resolve(tools)
  await expect.poll(() => queryClient.getQueryState(key('mcp-1'))?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(key('mcp-2'))?.isInvalidated).toBe(false)
})
