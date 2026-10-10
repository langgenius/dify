import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { MCPAccessPointCard } from '../built-in-access-points/mcp-card'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))

const clients: QueryClient[] = []
const appInfo = createAppDetailFixture({
  id: 'mcp-app',
  description: 'App description',
  api_base_url: 'https://api.example.test/v1',
  mode: AppModeEnum.CHAT,
  model_config: createAppModelConfigFixture({
    updated_at: 1_710_000_000,
    user_input_form: [
      { 'text-input': { label: 'Question', required: true, variable: 'question' } },
    ],
  }),
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  transport.mockReset()
  transport.mockImplementation((path: string[]) => {
    throw new Error(`Unexpected Console request: ${path.join('.')}`)
  })
})

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['first enable', 'configure'] as const)(
  'preserves the %s draft through exit, returns focus to its real entry, and reopens from fresh source',
  async (entryKind) => {
    let detail =
      entryKind === 'configure'
        ? {
            id: 'server-1',
            server_code: 'code',
            status: 'active',
            description: 'Published description',
            parameters: { question: 'Published hint' },
          }
        : {}
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.endsWith('/apps/mcp-app/server') || (init?.method && init.method !== 'GET'))
        throw new Error(`Unexpected request: ${init?.method} ${url}`)
      return Response.json(detail)
    })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })
    clients.push(client)
    const screen = await render(
      <QueryClientProvider client={client}>
        <MCPAccessPointCard
          appInfo={appInfo}
          canManageAccessPoint
          triggerModeDisabled={false}
          workflow={undefined}
          workflowLoading={false}
        />
      </QueryClientProvider>,
    )
    const configure = screen.getByRole('button', {
      name: entryKind === 'configure' ? 'tools.mcp.server.edit' : 'tools.mcp.server.addDescription',
    })
    await expect.element(configure).toBeEnabled()
    const entry = entryKind === 'first enable' ? screen.getByRole('switch') : configure
    ;(entry.element() as HTMLElement).focus()
    await userEvent.keyboard('{Space}')
    const dialog = screen.getByRole('dialog', {
      name:
        entryKind === 'configure'
          ? 'tools.mcp.server.modal.editTitle'
          : 'tools.mcp.server.modal.addTitle',
    })
    await expect.element(dialog).toBeVisible()
    const description = dialog.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
    const parameter = dialog.getByRole('textbox', { name: 'Question' })
    await description.fill('Unsaved description')
    await description.click()
    await userEvent.keyboard('{End}{Enter}second line')
    await expect.element(description).toHaveValue('Unsaved description\nsecond line')
    await parameter.fill('Unsaved hint')
    expect(transport).not.toHaveBeenCalled()
    const popup = dialog.element()
    await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
    const exitingDraft = new Promise<boolean>((resolve) => {
      const onTransition = (event: Event) => {
        if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
        popup.removeEventListener('transitionrun', onTransition)
        const fields = popup.querySelectorAll('textarea')
        resolve(
          popup.isConnected &&
            fields[0]?.value === 'Unsaved description\nsecond line' &&
            fields[1]?.value === 'Unsaved hint',
        )
      }
      popup.addEventListener('transitionrun', onTransition)
    })
    await dialog
      .getByRole('button', {
        name: entryKind === 'first enable' ? 'tools.mcp.modal.cancel' : 'common.operation.close',
      })
      .click()
    expect(await exitingDraft).toBe(true)
    await expect.poll(() => popup.isConnected).toBe(false)
    await expect.element(entry).toHaveFocus()
    if (entryKind === 'first enable')
      await expect.element(entry).toHaveAttribute('aria-checked', 'false')
    detail = {
      id: 'server-1',
      server_code: 'code',
      status: 'active',
      description: 'Fresh description',
      parameters: { question: 'Fresh hint' },
    }
    await client.invalidateQueries()
    const edit = screen.getByRole('button', { name: 'tools.mcp.server.edit' })
    await edit.click()
    const reopened = screen.getByRole('dialog', { name: 'tools.mcp.server.modal.editTitle' })
    await expect
      .element(reopened.getByRole('textbox', { name: 'tools.mcp.server.modal.description' }))
      .toHaveValue('Fresh description')
    await expect
      .element(reopened.getByRole('textbox', { name: 'Question' }))
      .toHaveValue('Fresh hint')
    await userEvent.keyboard('{Escape}')
    await expect.element(reopened).not.toBeInTheDocument()
    await expect.element(edit).toHaveFocus()
    expect(fetchSpy).toHaveBeenCalled()
  },
)
