import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import CreateAppModal from '@/app/components/app/create-app-modal'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  builderDefaultModel,
  builderModel,
  builderModelList,
  builderModelListQueryKey,
  createBuilderQueryClient,
} from '@/app/components/workflow-app/components/dify-builder/__tests__/model-fixtures'
import DifyBuilderComposer from '@/app/components/workflow-app/components/dify-builder/composer'
import { DifyBuilderProvider } from '@/app/components/workflow-app/components/dify-builder/provider'
import { commonQueryKeys } from '@/service/use-common'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(async () => ({
    id: 'created-app',
    mode: 'advanced-chat',
    maintainer: 'user-1',
  })),
  push: vi.fn(),
  setShowPanel: vi.fn(),
  setCanvasReadOnly: vi.fn(),
  syncDraft: vi.fn(async () => undefined),
  startBuild: vi.fn(async () => true),
  fetchDefaultModel: vi.fn(() => new Promise(() => {})),
  updateUrl: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp: vi.fn() }))
vi.mock('@/service/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/common')>()),
  fetchDefaultModal: mocks.fetchDefaultModel,
}))
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
vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      setShowDifyBuilderPanel: typeof mocks.setShowPanel
      setCanvasReadOnly: typeof mocks.setCanvasReadOnly
    }) => T,
  ) =>
    selector({
      setShowDifyBuilderPanel: mocks.setShowPanel,
      setCanvasReadOnly: mocks.setCanvasReadOnly,
    }),
}))
vi.mock(
  '@/app/components/workflow-app/components/dify-builder/session/use-session-controller',
  () => ({
    useDifyBuilderSessionController: () => ({ startBuild: mocks.startBuild }),
  }),
)

const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ onUrlUpdate: mocks.updateUrl })

function CreationFlow() {
  const [created, setCreated] = useState(false)
  return (
    <NuqsWrapper>
      {created ? (
        <DifyBuilderProvider
          appId="created-app"
          canEdit
          canStartCreation
          tenantId="workspace-1"
          userId="user-1"
          getCanvasSnapshot={() => ({ nodes: [], edgeCount: 0 })}
          onSyncDraft={mocks.syncDraft}
          onFocusCanvas={() => {}}
          onRefreshCanvas={async () => true}
        >
          <h1>New app editor</h1>
          <DifyBuilderComposer />
        </DifyBuilderProvider>
      ) : (
        <CreateAppModal show onClose={() => setCreated(true)} />
      )}
    </NuqsWrapper>
  )
}

describe('App Builder creation flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchDefaultModel.mockReset().mockImplementation(() => new Promise(() => {}))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      expect(url).toMatch(/\/workspaces\/current\/models\/model-types\/llm$/)
      return Response.json({ data: builderModelList })
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('hands the submitted prompt from the creation dialog to the new app and opens its Builder panel', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreationFlow />, {
      accountProfile: { id: 'user-1' },
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management'],
      queryClient: createBuilderQueryClient(),
    })

    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      '  Build an expense assistant  ',
    )
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))

    expect(await screen.findByRole('heading', { name: 'New app editor' })).toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant',
        builderModel,
      ),
    )
    expect(mocks.push).toHaveBeenCalledWith('/app/created-app/workflow')
    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(mocks.syncDraft).toHaveBeenCalledOnce()
    expect(mocks.createApp).toHaveBeenCalledOnce()
    expect(mocks.createApp).toHaveBeenCalledWith(
      { body: expect.objectContaining({ name: 'app.newApp.defaultName', description: '' }) },
      expect.anything(),
    )
    expect(mocks.startBuild).toHaveBeenCalledOnce()
  })

  it('keeps the creation prompt when there is no default model and does not start when models later change', async () => {
    const user = userEvent.setup()
    const queryClient = createBuilderQueryClient({ defaultModel: null })
    renderWithConsoleQuery(<CreationFlow />, {
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management'],
      queryClient,
    })
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))

    expect(await screen.findByRole('heading', { name: 'New app editor' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.setShowPanel).toHaveBeenCalledWith(true))
    expect(mocks.startBuild).not.toHaveBeenCalled()
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    const composer = screen.getByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    await waitFor(() => expect(composer).toHaveValue('Build an expense assistant'))
    expect(composer).toBeEnabled()
    expect(composer).toHaveAccessibleDescription('workflow.workflowGenerator.modelRequired')
    expect(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' })).toBeDisabled()
    await act(async () =>
      queryClient.setQueryData(builderModelListQueryKey, { data: builderModelList }),
    )
    expect(mocks.startBuild).not.toHaveBeenCalled()
    expect(mocks.createApp).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'common.modelProvider.model' }))
    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    await user.click(await screen.findByRole('button', { name: /gpt-4.1/ }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))

    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant',
        builderModel,
      ),
    )
    expect(mocks.createApp).toHaveBeenCalledOnce()
  })

  it('opens model settings without losing the prompt, and waits for an explicit send after configuration', async () => {
    const user = userEvent.setup()
    const queryClient = createBuilderQueryClient({ defaultModel: null, models: [] })
    renderWithConsoleQuery(<CreationFlow />, {
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management', 'plugin.model_config'],
      queryClient,
    })
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    const composer = await screen.findByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    await waitFor(() => expect(composer).toHaveValue('Build an expense assistant'))
    await user.type(composer, ' with approval steps')
    await user.click(screen.getByRole('button', { name: 'workflow.errorMsg.configureModel' }))
    await waitFor(() =>
      expect(mocks.updateUrl).toHaveBeenCalledWith(
        expect.objectContaining({ queryString: '?settings=provider' }),
      ),
    )
    expect(composer).toHaveValue('Build an expense assistant with approval steps')

    await act(async () => {
      queryClient.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), {
        data: builderDefaultModel,
      })
      queryClient.setQueryData(builderModelListQueryKey, { data: builderModelList })
    })
    expect(mocks.startBuild).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant with approval steps',
        builderModel,
      ),
    )
    expect(mocks.createApp).toHaveBeenCalledOnce()
  })

  it('guides users without model configuration permission to an administrator', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreationFlow />, {
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management'],
      queryClient: createBuilderQueryClient({ defaultModel: null, models: [] }),
    })
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    const composer = await screen.findByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    expect(composer).toHaveAccessibleDescription('workflow.difyBuilder.modelContactAdmin')
    expect(composer).toHaveValue('Build an expense assistant')
    expect(
      screen.queryByRole('button', { name: 'workflow.errorMsg.configureModel' }),
    ).not.toBeInTheDocument()
    expect(mocks.startBuild).not.toHaveBeenCalled()
  })

  it('retains the prompt after a model query fails and allows retry without automatically submitting', async () => {
    mocks.fetchDefaultModel.mockRejectedValueOnce(new Error('Network unavailable'))
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreationFlow />, {
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management'],
      queryClient: createBuilderQueryClient({ defaultLoading: true }),
    })
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'workflow.difyBuilder.modelLoadFailed',
    )
    const composer = screen.getByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    expect(composer).toHaveValue('Build an expense assistant')
    expect(mocks.startBuild).not.toHaveBeenCalled()

    mocks.fetchDefaultModel.mockResolvedValueOnce({ data: builderDefaultModel })
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(mocks.startBuild).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant',
        builderModel,
      ),
    )
    expect(mocks.createApp).toHaveBeenCalledOnce()
  })

  it('waits for the model list before starting the submitted prompt', async () => {
    const user = userEvent.setup()
    const queryClient = createBuilderQueryClient({ modelsLoading: true })
    renderWithConsoleQuery(<CreationFlow />, {
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management'],
      queryClient,
    })
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    expect(await screen.findByRole('heading', { name: 'New app editor' })).toBeInTheDocument()
    expect(mocks.startBuild).not.toHaveBeenCalled()
    await act(async () =>
      queryClient.setQueryData(builderModelListQueryKey, { data: builderModelList }),
    )
    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant',
        builderModel,
      ),
    )
    expect(mocks.startBuild).toHaveBeenCalledOnce()
  })
})
