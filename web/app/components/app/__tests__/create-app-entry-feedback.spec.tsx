import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FirstEmptyState from '@/app/components/apps/first-empty-state'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { CreateAppEntry } from '../create-app-entry'
import { promptDefaultModel, promptModelProviders } from './prompt-model-fixtures'

const mocks = vi.hoisted(() => ({
  create: vi.fn<() => Promise<Response>>(),
  improve: vi.fn<() => Promise<Response>>(),
  push: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp: vi.fn() }))

let builderEnabled = false

function renderEntry(builder = false, surface: 'menu' | 'empty' = 'menu') {
  builderEnabled = builder
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  return renderWithConsoleQuery(
    <NuqsWrapper>
      {surface === 'menu' ? (
        <CreateAppEntry />
      ) : (
        <FirstEmptyState onCreateTemplate={vi.fn()} onImportDSL={vi.fn()} showLearnDify={false} />
      )}
    </NuqsWrapper>,
    {
      accountProfile: { id: 'creator' },
      workspacePermissionKeys: ['app.create_and_management'],
      features: { dify_builder_enabled: builder },
    },
  )
}

async function selectWorkflow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
  await user.click(screen.getByRole('menuitem', { name: 'app.types.workflow' }))
}

async function openStarter(user: ReturnType<typeof userEvent.setup>) {
  await selectWorkflow(user)
  const input = await screen.findByRole('textbox', { name: 'app.newApp.starter.workflowTitle' })
  await user.type(input, 'Original prompt')
  return input
}

describe('Create app feedback', () => {
  beforeEach(() => {
    mocks.create
      .mockReset()
      .mockImplementation(async () =>
        Response.json(
          createAppDetailFixture({ id: 'created-app', mode: 'workflow', maintainer: 'creator' }),
        ),
      )
    mocks.improve
      .mockReset()
      .mockImplementation(async () =>
        Response.json({ instruction: 'Improved prompt', changed: true }),
      )
    vi.spyOn(toast, 'success').mockReturnValue('success-toast')
    vi.spyOn(toast, 'error').mockReturnValue('error-toast')
    vi.spyOn(toast, 'info').mockReturnValue('info-toast')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/apps') && request.method === 'POST') return mocks.create()
      if (pathname.endsWith('/workflow-generate/improve')) return mocks.improve()
      if (pathname.endsWith('/workspaces/current/default-model'))
        return Response.json({ data: promptDefaultModel })
      if (pathname.endsWith('/workspaces/current/models/model-types/llm'))
        return Response.json({ data: promptModelProviders })
      if (pathname.endsWith('/features'))
        return Response.json(zGetFeaturesResponse.parse({ dify_builder_enabled: builderEnabled }))
      throw new Error(`Unexpected request: ${request.method} ${pathname}`)
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('navigates to the created app without a success toast', async () => {
    const user = userEvent.setup()
    renderEntry()
    await selectWorkflow(user)

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/created-app/workflow'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'shows one inline server error with Builder enabled=%s and clears it on retry',
    async (builder) => {
      mocks.create.mockResolvedValueOnce(
        Response.json(
          { code: 'app_creation_failed', message: 'Creation unavailable' },
          { status: 400 },
        ),
      )
      const user = userEvent.setup()
      renderEntry(builder)
      if (builder) {
        await openStarter(user)
        await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
      } else {
        await selectWorkflow(user)
      }

      expect(await screen.findByRole('alert')).toHaveTextContent('Creation unavailable')
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(toast.error).not.toHaveBeenCalled()
      expect(mocks.push).not.toHaveBeenCalled()

      if (builder) {
        const input = screen.getByRole('textbox', { name: 'app.newApp.starter.workflowTitle' })
        expect(input).toHaveValue('Original prompt')
        expect(input).toHaveAccessibleDescription('Creation unavailable')
        await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
      } else {
        await selectWorkflow(user)
      }
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/created-app/workflow'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it.each(['menu', 'empty'] as const)(
    'keeps network failures visible at the %s creation entry',
    async (surface) => {
      mocks.create.mockRejectedValueOnce(new TypeError('Network unavailable'))
      const user = userEvent.setup()
      renderEntry(false, surface)
      if (surface === 'menu') await selectWorkflow(user)
      else await user.click(screen.getByRole('button', { name: /app.types.workflow/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
      expect(toast.error).not.toHaveBeenCalled()
      expect(mocks.push).not.toHaveBeenCalled()
    },
  )

  it('shows optimization failures beside the prompt and allows retry without a toast', async () => {
    mocks.improve.mockResolvedValueOnce(
      Response.json({ message: 'Model request failed' }, { status: 500 }),
    )
    const user = userEvent.setup()
    renderEntry(true)
    const input = await openStarter(user)
    const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
    await waitFor(() => expect(optimize).toBeEnabled())
    await user.click(optimize)

    expect(await screen.findByRole('alert')).toHaveTextContent('app.newApp.optimizeFailed')
    expect(input).toHaveValue('Original prompt')
    expect(input).toHaveAccessibleDescription('app.newApp.optimizeFailed')
    expect(optimize).toHaveAccessibleDescription('app.newApp.optimizeFailed')
    expect(toast.error).not.toHaveBeenCalled()
    await user.click(optimize)

    await waitFor(() => expect(input).toHaveValue('Improved prompt'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows unchanged optimization inline and clears the status when the prompt changes', async () => {
    mocks.improve.mockResolvedValueOnce(
      Response.json({ instruction: 'Original prompt', changed: false }),
    )
    const user = userEvent.setup()
    renderEntry(true)
    const input = await openStarter(user)
    const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
    await waitFor(() => expect(optimize).toBeEnabled())
    await user.click(optimize)

    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'app.newApp.optimizeNoChange',
    )
    expect(input).toHaveValue('Original prompt')
    expect(toast.info).not.toHaveBeenCalled()
    await user.type(input, ' with new details')

    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-describedby')
  })
})
