import type { CreateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery, seedFeatures } from '@/test/console/query-data'
import { CreateAppEntry } from '../create-app-entry'

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(async ({ body }: { body: CreateAppPayload }) => ({
    id: 'created-app',
    mode: body.mode,
    maintainer: 'creator',
  })),
  push: vi.fn(),
  template: vi.fn(),
  importDSL: vi.fn(),
  trackCreateApp: vi.fn<() => Promise<void> | undefined>(),
}))

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp: mocks.trackCreateApp }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      account: actual.consoleQuery.account,
      features: actual.consoleQuery.features,
      systemFeatures: actual.consoleQuery.systemFeatures,
      workspaces: actual.consoleQuery.workspaces,
      trialModels: actual.consoleQuery.trialModels,
      apps: {
        ...actual.consoleQuery.apps,
        post: { mutationOptions: () => ({ mutationFn: mocks.createApp }) },
      },
    },
  }
})

function renderEntry(options: ConsoleQueryTestOptions = {}) {
  return renderWithConsoleQuery(
    <CreateAppEntry onCreateTemplate={mocks.template} onImportDSL={mocks.importDSL} />,
    {
      accountProfile: { id: 'creator' },
      workspacePermissionKeys: ['app.create_and_management'],
      features: { dify_builder_enabled: false },
      ...options,
    },
  )
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
}

describe('Create app entry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('collapses additional types and exposes the matching descriptions on hover and keyboard focus', async () => {
    const user = userEvent.setup()
    renderEntry()
    await openMenu(user)
    const workflow = screen.getByRole('menuitem', { name: 'app.types.workflow' })
    expect(workflow).toHaveAccessibleDescription('app.newApp.menu.workflowDescription')
    await user.hover(workflow)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'app.newApp.menu.workflowDescription',
    )
    await user.unhover(workflow)
    const chatflow = screen.getByRole('menuitem', { name: 'app.types.advanced' })
    act(() => chatflow.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'app.newApp.menu.chatflowDescription',
    )
    expect(screen.queryByRole('menuitem', { name: 'app.types.agent' })).not.toBeInTheDocument()
    const more = screen.getByRole('menuitem', { name: 'app.newApp.menu.moreTypes' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'app.types.agent' })).toHaveAccessibleDescription(
      'app.newApp.menu.agentDescription',
    )
    expect(screen.getByRole('menuitem', { name: 'app.types.chatbot' })).toHaveAccessibleDescription(
      'app.newApp.menu.chatbotDescription',
    )
    expect(
      screen.getByRole('menuitem', { name: 'app.newApp.completeApp' }),
    ).toHaveAccessibleDescription('app.newApp.menu.completionDescription')
    await user.keyboard('{Escape}')
    await openMenu(user)
    expect(screen.getByRole('menuitem', { name: 'app.newApp.menu.moreTypes' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it.each([
    ['workflow', 'app.types.workflow', '/workflow'],
    ['advanced-chat', 'app.types.advanced', '/workflow'],
    ['agent-chat', 'app.types.agent', '/configuration'],
    ['chat', 'app.types.chatbot', '/configuration'],
    ['completion', 'app.newApp.completeApp', '/configuration'],
  ])('creates %s directly with Builder disabled', async (mode, label, route) => {
    const user = userEvent.setup()
    renderEntry()
    await openMenu(user)
    if (!['workflow', 'advanced-chat'].includes(mode))
      await user.click(screen.getByRole('menuitem', { name: 'app.newApp.menu.moreTypes' }))
    await user.click(screen.getByRole('menuitem', { name: label }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/app/created-app${route}`))
    expect(mocks.createApp).toHaveBeenCalledExactlyOnceWith(
      {
        body: {
          mode,
          name: 'app.newApp.untitled',
          description: '',
          icon_type: 'emoji',
          icon: '\u{1F916}',
          icon_background: '#FFEAD5',
        },
      },
      expect.anything(),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['workflow', 'app.types.workflow', 'app.newApp.starter.workflowTitle'],
    ['advanced-chat', 'app.types.advanced', 'app.newApp.starter.chatflowTitle'],
  ])(
    'opens the %s starter and derives a name from the submitted prompt',
    async (mode, label, title) => {
      const user = userEvent.setup()
      renderEntry({ features: { dify_builder_enabled: true } })
      await openMenu(user)
      await user.click(screen.getByRole('menuitem', { name: label }))
      const input = await screen.findByRole('textbox', { name: title })
      const send = screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' })
      expect(send).toBeDisabled()
      expect(mocks.createApp).not.toHaveBeenCalled()
      await user.type(input, '  Summarize support tickets  ')
      await user.click(send)
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/created-app/workflow'))
      expect(mocks.createApp).toHaveBeenCalledExactlyOnceWith(
        {
          body: {
            mode,
            prompt: 'Summarize support tickets',
            description: '',
            icon_type: 'emoji',
            icon: '\u{1F916}',
            icon_background: '#FFEAD5',
          },
        },
        expect.anything(),
      )
    },
  )

  it('keeps non-canvas app creation direct with Builder enabled', async () => {
    const user = userEvent.setup()
    renderEntry({ features: { dify_builder_enabled: true } })
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.newApp.menu.moreTypes' }))
    await user.click(screen.getByRole('menuitem', { name: 'app.types.agent' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/created-app/configuration'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('navigates after creation without waiting for analytics to finish', async () => {
    const user = userEvent.setup()
    let finishTracking!: () => void
    const tracking = new Promise<void>((resolve) => {
      finishTracking = resolve
    })
    mocks.trackCreateApp.mockReturnValueOnce(tracking)
    renderEntry()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.types.workflow' }))

    try {
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/created-app/workflow'))
      expect(mocks.trackCreateApp).toHaveBeenCalledExactlyOnceWith({
        source: 'studio_blank',
        appMode: 'workflow',
      })
    } finally {
      finishTracking()
      await tracking
    }
  })

  it('starts with an empty prompt after closing and reopening the starter', async () => {
    const user = userEvent.setup()
    renderEntry({ features: { dify_builder_enabled: true } })
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.types.workflow' }))
    await user.type(
      await screen.findByRole('textbox', { name: 'app.newApp.starter.workflowTitle' }),
      'Discarded draft',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.types.advanced' }))

    expect(
      await screen.findByRole('textbox', { name: 'app.newApp.starter.chatflowTitle' }),
    ).toHaveValue('')
    expect(mocks.createApp).not.toHaveBeenCalled()
  })

  it('can start from a suggestion or create a blank canvas without submitting it', async () => {
    const user = userEvent.setup()
    renderEntry({ features: { dify_builder_enabled: true } })
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.types.workflow' }))
    const input = await screen.findByRole('textbox', { name: 'app.newApp.starter.workflowTitle' })
    await user.click(screen.getByRole('button', { name: 'app.newApp.starter.invoices' }))
    expect(input).toHaveValue('app.newApp.starter.invoices')
    expect(input).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'app.newApp.starter.openBlank' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalled())
    expect(mocks.createApp.mock.calls[0]?.[0].body).toMatchObject({
      mode: 'workflow',
      name: 'app.newApp.untitled',
    })
    expect(mocks.createApp.mock.calls[0]?.[0].body).not.toHaveProperty('prompt')
  })

  it('retains the prompt after failure and prevents duplicate submissions while retrying', async () => {
    mocks.createApp.mockRejectedValueOnce(new Error('Create failed'))
    const user = userEvent.setup()
    renderEntry({ features: { dify_builder_enabled: true } })
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.types.workflow' }))
    const input = await screen.findByRole('textbox', { name: 'app.newApp.starter.workflowTitle' })
    await user.type(input, 'Build an assistant')
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Create failed')
    expect(input).toHaveValue('Build an assistant')
    let resolveCreation!: (app: Awaited<ReturnType<typeof mocks.createApp>>) => void
    mocks.createApp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreation = resolve
        }),
    )
    await user.dblClick(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    expect(mocks.createApp).toHaveBeenCalledTimes(2)
    expect(input).toBeDisabled()
    await act(async () =>
      resolveCreation({ id: 'created-app', mode: 'workflow', maintainer: 'creator' }),
    )
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce())
  })

  it('closes the starter if Builder is disabled while it is open', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderEntry({ features: { dify_builder_enabled: true } })
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.types.workflow' }))
    await screen.findByRole('textbox', { name: 'app.newApp.starter.workflowTitle' })
    await act(async () => {
      seedFeatures(queryClient, { dify_builder_enabled: false })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.createApp).not.toHaveBeenCalled()
  })

  it('disables creation without permission', async () => {
    const user = userEvent.setup()
    renderEntry({ workspacePermissionKeys: [] })
    await openMenu(user)
    const workflow = screen.getByRole('menuitem', { name: 'app.types.workflow' })
    expect(workflow).toHaveAttribute('aria-disabled', 'true')
    await user.click(workflow)
    expect(mocks.createApp).not.toHaveBeenCalled()
  })

  it('preserves template and DSL entry points', async () => {
    const user = userEvent.setup()
    renderEntry()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.newApp.menu.startFromTemplate' }))
    expect(mocks.template).toHaveBeenCalledOnce()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /app.importDSL/ }))
    expect(mocks.importDSL).toHaveBeenCalledOnce()
    expect(mocks.createApp).not.toHaveBeenCalled()
  })

  it('shows the workspace quota without creating an app', async () => {
    const user = userEvent.setup()
    renderEntry({
      features: {
        dify_builder_enabled: true,
        apps: { size: 10, limit: 10 },
        billing: { subscription: { plan: 'team' } },
      },
      systemFeatures: { deployment_edition: 'CLOUD' },
    })
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'app.types.workflow' }))
    expect(
      await screen.findByRole('meter', { name: 'billing.usagePage.buildApps' }),
    ).toHaveAttribute('aria-valuenow', '100')
    expect(mocks.createApp).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
