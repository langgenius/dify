import type {
  WorkflowInstructionImprovePayload,
  WorkflowInstructionImproveResponse,
} from '@dify/contracts/api/console/workflow-generate/types.gen'
import type { ReactElement } from 'react'
import type { consoleClient } from '@/service/console'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import {
  mockPromptModelQueries,
  promptDefaultModel,
  promptModelProviders,
} from '../../__tests__/prompt-model-fixtures'
import { AppBuilderInput } from '../app-builder-input'

const mocks = vi.hoisted(() => ({
  improve: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  submit: vi.fn(),
  defaultModel: vi.fn<typeof consoleClient.workspaces.current.defaultModel.get>(),
  models: vi.fn<typeof consoleClient.workspaces.current.models.modelTypes.byModelType.get>(),
}))
vi.mock('@/app/notifications', () => ({ toast: { info: mocks.info, error: mocks.error } }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      workspaces: actual.consoleQuery.workspaces,
      workflowGenerate: {
        improve: {
          post: {
            mutationOptions: (
              options: Parameters<
                typeof actual.consoleQuery.workflowGenerate.improve.post.mutationOptions
              >[0],
            ) => ({
              ...options,
              mutationFn: ({ body }: { body: WorkflowInstructionImprovePayload }) =>
                mocks.improve(body),
            }),
          },
        },
      },
    },
  }
})

const Harness = ({ mode = 'workflow' }: { mode?: WorkflowInstructionImprovePayload['mode'] }) => {
  const [prompt, setPrompt] = useState('')
  return (
    <form onSubmit={mocks.submit}>
      <h2 id="prompt-label">Workflow goal</h2>
      <AppBuilderInput
        key={mode}
        titleId="prompt-label"
        prompt={prompt}
        mode={mode}
        onPromptChange={setPrompt}
        isCreating={false}
        createDisabled={false}
      />
    </form>
  )
}

const promptInput = () => screen.getByRole('textbox', { name: 'Workflow goal' })

const renderInput = (ui: ReactElement, permissions = ['plugin.model_config']) => {
  const queryClient = createConsoleQueryClient()
  seedWorkspacePermissionsQuery(queryClient, permissions)
  const QueryWrapper = createQueryClientWrapper(queryClient)
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper()
  return {
    ...render(ui, {
      wrapper: ({ children }) => (
        <QueryWrapper>
          <NuqsWrapper>{children}</NuqsWrapper>
        </QueryWrapper>
      ),
    }),
    onUrlUpdate,
    queryClient,
  }
}

describe('AppBuilderInput optimization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.defaultModel.mockResolvedValue({ data: promptDefaultModel })
    mocks.models.mockResolvedValue({ data: promptModelProviders })
    mockPromptModelQueries(mocks)
  })

  afterEach(() => vi.restoreAllMocks())

  it.each(['plugin.model_config', 'plugin.plugin_preferences'])(
    'disables optimization before interaction and offers configuration on hover with %s permission',
    async (permission) => {
      mocks.defaultModel.mockResolvedValue({ data: null })
      mocks.improve.mockResolvedValue({ changed: true, instruction: 'Improved goal' })
      const user = userEvent.setup()
      const { onUrlUpdate, queryClient } = renderInput(<Harness />, [permission])
      const input = promptInput()
      const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
      await waitFor(() => expect(mocks.defaultModel).toHaveBeenCalledOnce())
      expect(optimize).toHaveAttribute('aria-disabled', 'true')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.type(input, 'Original goal')
      expect(optimize).toHaveAttribute('aria-disabled', 'true')
      await user.hover(optimize)
      expect(
        await screen.findByRole('dialog', { name: 'app.newApp.optimizeWithAI' }),
      ).toHaveAccessibleDescription('app.newApp.optimizeModelRequired')
      await user.click(optimize)
      expect(mocks.improve).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'workflow.errorMsg.configureModel' }))
      await waitFor(() =>
        expect(onUrlUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ queryString: '?settings=provider' }),
        ),
      )
      expect(input).toHaveValue('Original goal')
      expect(mocks.submit).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      mocks.defaultModel.mockResolvedValue({ data: promptDefaultModel })
      await act(async () =>
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.defaultModel.get.key(),
        }),
      )
      await waitFor(() => expect(optimize).not.toHaveAttribute('aria-disabled', 'true'))
      await user.click(optimize)
      await waitFor(() => expect(input).toHaveValue('Improved goal'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.defaultModel).toHaveBeenCalledTimes(2)
    },
  )

  it('shows guidance on keyboard focus and keeps optimization disabled after dismissal', async () => {
    mocks.defaultModel.mockResolvedValue({ data: null })
    const user = userEvent.setup()
    renderInput(<Harness />)
    await user.type(promptInput(), 'Original goal')
    const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
    await user.tab()
    expect(optimize).toHaveFocus()
    expect(
      await screen.findByRole('dialog', { name: 'app.newApp.optimizeWithAI' }),
    ).toHaveAccessibleDescription('app.newApp.optimizeModelRequired')
    await user.keyboard('{Enter} ')
    expect(mocks.improve).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(optimize).toHaveAttribute('aria-disabled', 'true')
    expect(promptInput()).toHaveValue('Original goal')
    await user.click(promptInput())
    await user.hover(optimize)
    await screen.findByRole('dialog', { name: 'app.newApp.optimizeWithAI' })
    expect(mocks.defaultModel).toHaveBeenCalledOnce()
  })

  it('asks users without configuration permission to contact an administrator on hover', async () => {
    mocks.defaultModel.mockResolvedValue({ data: null })
    const user = userEvent.setup()
    renderInput(<Harness />, [])
    const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
    expect(optimize).toHaveAttribute('aria-disabled', 'true')
    await user.hover(optimize)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'app.newApp.optimizeModelContactAdmin',
    )
    expect(
      screen.queryByRole('button', { name: 'workflow.errorMsg.configureModel' }),
    ).not.toBeInTheDocument()
    expect(mocks.improve).not.toHaveBeenCalled()
  })

  it.each(['removed-provider', 'no-configure', 'credential-removed', 'disabled'] as const)(
    'disables an unavailable default model (%s) even when a saved default exists',
    async (status) => {
      mocks.models.mockResolvedValue({
        data:
          status === 'removed-provider'
            ? []
            : promptModelProviders.map((provider) => ({
                ...provider,
                status: status === 'no-configure' ? status : 'active',
                models: provider.models.map((model) => ({
                  ...model,
                  status: status === 'no-configure' ? 'active' : status,
                })),
              })),
      })
      const user = userEvent.setup()
      renderInput(<Harness />)
      await user.type(promptInput(), 'Original goal')
      const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
      expect(optimize).toHaveAttribute('aria-disabled', 'true')
      await user.hover(optimize)
      expect(await screen.findByRole('status')).toHaveTextContent(
        'app.newApp.optimizeModelRequired',
      )
      expect(mocks.improve).not.toHaveBeenCalled()
    },
  )

  it('offers retry in the hover guide when model loading fails', async () => {
    mocks.defaultModel.mockRejectedValueOnce(new Error('offline'))
    mocks.improve.mockResolvedValue({ changed: true, instruction: 'Improved goal' })
    const user = userEvent.setup()
    renderInput(<Harness />)
    await user.type(promptInput(), 'Original goal')
    const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
    expect(optimize).toHaveAttribute('aria-disabled', 'true')
    await user.hover(optimize)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'workflow.difyBuilder.modelLoadFailed',
    )
    expect(
      screen.queryByRole('button', { name: 'workflow.errorMsg.configureModel' }),
    ).not.toBeInTheDocument()
    expect(mocks.improve).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(optimize).not.toHaveAttribute('aria-disabled', 'true'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(optimize)
    await waitFor(() => expect(promptInput()).toHaveValue('Improved goal'))
  })

  it('stays disabled while the automatic model check is pending', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof mocks.defaultModel>>) => void
    mocks.defaultModel.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const user = userEvent.setup()
    renderInput(<Harness />)
    await user.type(promptInput(), 'Original goal')
    const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
    expect(optimize).toHaveAttribute('aria-disabled', 'true')
    await user.click(optimize)
    expect(mocks.defaultModel).toHaveBeenCalledOnce()
    expect(mocks.improve).not.toHaveBeenCalled()
    await user.hover(optimize)
    expect(await screen.findByRole('status')).toHaveTextContent('workflow.difyBuilder.modelLoading')
    await act(async () => resolve({ data: null }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('app.newApp.optimizeModelRequired'),
    )
    expect(optimize).toHaveAttribute('aria-disabled', 'true')
  })

  it.each(['workflow', 'advanced-chat'] as const)(
    'optimizes a %s goal without creating an app',
    async (mode) => {
      mocks.improve.mockResolvedValue({
        changed: true,
        instruction: 'Collect receipts and summarize expenses',
      })
      const user = userEvent.setup()
      renderInput(<Harness mode={mode} />)
      const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
      await waitFor(() => expect(optimize).toBeDisabled())
      const input = promptInput()
      await user.type(input, 'Build an expense workflow')
      await user.click(optimize)
      await waitFor(() => expect(input).toHaveValue('Collect receipts and summarize expenses'))
      expect(mocks.improve).toHaveBeenCalledWith(
        expect.objectContaining({
          instruction: 'Build an expense workflow',
          mode,
        }),
      )
      expect(mocks.submit).not.toHaveBeenCalled()
    },
  )

  it('keeps newer input and prevents repeated requests while optimization is pending', async () => {
    let resolve!: (result: WorkflowInstructionImproveResponse) => void
    mocks.improve.mockReturnValue(
      new Promise<WorkflowInstructionImproveResponse>((done) => {
        resolve = done
      }),
    )
    const user = userEvent.setup()
    renderInput(<Harness />)
    const input = promptInput()
    const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
    await user.type(input, 'Original goal')
    await user.click(optimize)
    expect(optimize).toHaveAttribute('aria-disabled', 'true')
    await user.click(optimize)
    await user.clear(input)
    await user.type(input, 'New goal')
    await act(async () => resolve({ changed: true, instruction: 'Outdated improvement' }))
    expect(input).toHaveValue('New goal')
    expect(mocks.improve).toHaveBeenCalledOnce()
  })

  it('discards an optimization from a previous app mode', async () => {
    let resolve!: (result: WorkflowInstructionImproveResponse) => void
    mocks.improve.mockReturnValue(
      new Promise<WorkflowInstructionImproveResponse>((done) => {
        resolve = done
      }),
    )
    const user = userEvent.setup()
    const { rerender } = renderInput(<Harness />)
    await user.type(promptInput(), 'My goal')
    await user.click(screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' }))
    rerender(<Harness mode="advanced-chat" />)
    await act(async () => resolve({ changed: true, instruction: 'Workflow-only goal' }))
    expect(promptInput()).toHaveValue('My goal')
  })

  it('retains the original prompt after no change or failure and permits retry', async () => {
    mocks.improve
      .mockResolvedValueOnce({ changed: false, instruction: 'Original goal' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ changed: true, instruction: 'Improved goal' })
    const user = userEvent.setup()
    renderInput(<Harness />)
    const input = promptInput()
    const optimize = screen.getByRole('button', { name: 'app.newApp.optimizeWithAI' })
    await user.type(input, 'Original goal')
    await user.click(optimize)
    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('app.newApp.optimizeNoChange'))
    expect(input).toHaveValue('Original goal')
    await user.click(optimize)
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('app.newApp.optimizeFailed'))
    expect(input).toHaveValue('Original goal')
    await user.click(optimize)
    await waitFor(() => expect(input).toHaveValue('Improved goal'))
  })
})
