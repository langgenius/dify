import type { useDifyBuilderSessionController } from '@/app/components/workflow-app/components/dify-builder/session/use-session-controller'
import { zDefaultModelDataResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { CreateAppEntry } from '@/app/components/app/create-app-entry'
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
import { consoleQuery } from '@/service/console'
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
  setBuilderViewportManuallyChanged: vi.fn(),
  syncDraft: vi.fn(async () => undefined),
  startBuild: vi.fn(async () => true),
  useSessionController: vi.fn(),
  fetchDefaultModel: vi.fn(() => new Promise(() => {})),
  updateUrl: vi.fn(),
  runEvents: {
    onWorkflowEvent: vi.fn(),
    onStreamInterrupted: vi.fn(),
    onCanvasEvent: vi.fn(),
    restoreRun: vi.fn(),
    finishCommand: vi.fn(),
    reset: vi.fn(),
    onCanvasRefreshed: vi.fn(),
  },
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp: vi.fn() }))
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
      workflowGenerate: actual.consoleQuery.workflowGenerate,
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
  useWorkflowStore: () => ({
    getState: () => ({
      builderViewportManuallyChanged: false,
      setBuilderViewportManuallyChanged: mocks.setBuilderViewportManuallyChanged,
    }),
  }),
}))
vi.mock('@/app/components/workflow-app/components/dify-builder/provider/use-run-events', () => ({
  useDifyBuilderRunEvents: () => mocks.runEvents,
}))
vi.mock(
  '@/app/components/workflow-app/components/dify-builder/session/use-session-controller',
  () => ({
    useDifyBuilderSessionController: (
      ...args: Parameters<typeof useDifyBuilderSessionController>
    ) => {
      mocks.useSessionController(...args)
      return {
        startBuild: mocks.startBuild,
        onCanvasRefreshed: mocks.runEvents.onCanvasRefreshed,
      }
    },
  }),
)

const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ onUrlUpdate: mocks.updateUrl })

function CreationFlow() {
  const [created, setCreated] = useState(false)
  useEffect(() => {
    mocks.push.mockImplementation(() => setCreated(true))
  }, [])
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
          onRefreshCanvas={async () => true}
        >
          <h1>New app editor</h1>
          <DifyBuilderComposer />
        </DifyBuilderProvider>
      ) : (
        <CreateAppEntry />
      )}
    </NuqsWrapper>
  )
}

async function openStarter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
  await user.click(screen.getByRole('menuitem', { name: 'app.types.advanced' }))
  await screen.findByRole('textbox', { name: 'app.newApp.starter.chatflowTitle' })
}

describe('App Builder creation flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchDefaultModel.mockReset().mockImplementation(() => new Promise(() => {}))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/default-model?model_type=llm'))
        return Response.json(await mocks.fetchDefaultModel())
      expect(url).toMatch(/\/workspaces\/current\/models\/model-types\/llm$/)
      return Response.json({ data: builderModelList })
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps the creation prompt when there is no default model and does not start when models later change', async () => {
    const user = userEvent.setup()
    const queryClient = createBuilderQueryClient({ defaultModel: null })
    renderWithConsoleQuery(<CreationFlow />, {
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management'],
      queryClient,
    })
    await openStarter(user)
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.starter.chatflowTitle' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))

    expect(await screen.findByRole('heading', { name: 'New app editor' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.setShowPanel).toHaveBeenCalledWith(true))
    expect(mocks.startBuild).not.toHaveBeenCalled()
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    const composer = screen.getByRole('textbox', {
      name: 'difyBuilder.messagePlaceholder',
    })
    await waitFor(() => expect(composer).toHaveValue('Build an expense assistant'))
    expect(composer).toBeEnabled()
    expect(composer).toHaveAccessibleDescription('difyBuilder.modelRequired')
    expect(screen.getByRole('button', { name: 'difyBuilder.messageSend' })).toBeDisabled()
    await act(async () =>
      queryClient.setQueryData(builderModelListQueryKey, { data: builderModelList }),
    )
    expect(mocks.startBuild).not.toHaveBeenCalled()
    expect(mocks.createApp).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'modelProvider.modelProvider.model' }))
    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    await user.click(await screen.findByRole('button', { name: /gpt-4.1/ }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))

    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant',
        builderModel,
        true,
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
    await openStarter(user)
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.starter.chatflowTitle' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
    const composer = await screen.findByRole('textbox', {
      name: 'difyBuilder.messagePlaceholder',
    })
    await waitFor(() => expect(composer).toHaveValue('Build an expense assistant'))
    await user.type(composer, ' with approval steps')
    await user.click(screen.getByRole('button', { name: 'difyBuilder.configureModel' }))
    await waitFor(() =>
      expect(mocks.updateUrl).toHaveBeenCalledWith(
        expect.objectContaining({ queryString: '?settings=provider' }),
      ),
    )
    expect(composer).toHaveValue('Build an expense assistant with approval steps')

    await act(async () => {
      queryClient.setQueryData(
        consoleQuery.workspaces.current.defaultModel.get.queryKey({
          input: { query: { model_type: ModelTypeEnum.textGeneration } },
        }),
        zDefaultModelDataResponse.parse({ data: builderDefaultModel }),
      )
      queryClient.setQueryData(builderModelListQueryKey, { data: builderModelList })
    })
    expect(mocks.startBuild).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant with approval steps',
        builderModel,
        true,
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
    await openStarter(user)
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.starter.chatflowTitle' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
    const composer = await screen.findByRole('textbox', {
      name: 'difyBuilder.messagePlaceholder',
    })
    expect(composer).toHaveAccessibleDescription('difyBuilder.modelContactAdmin')
    expect(composer).toHaveValue('Build an expense assistant')
    expect(
      screen.queryByRole('button', { name: 'difyBuilder.configureModel' }),
    ).not.toBeInTheDocument()
    expect(mocks.startBuild).not.toHaveBeenCalled()
  })

  it('retains the prompt after a model query fails and allows retry without automatically submitting', async () => {
    mocks.fetchDefaultModel.mockRejectedValue(new Error('Network unavailable'))
    const user = userEvent.setup()
    const queryClient = createBuilderQueryClient()
    queryClient.removeQueries({
      queryKey: consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type: ModelTypeEnum.textGeneration } },
      }),
    })
    renderWithConsoleQuery(<CreationFlow />, {
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management'],
      queryClient,
    })
    await openStarter(user)
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.starter.chatflowTitle' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('difyBuilder.modelLoadFailed')
    const composer = screen.getByRole('textbox', {
      name: 'difyBuilder.messagePlaceholder',
    })
    expect(composer).toHaveValue('Build an expense assistant')
    expect(mocks.startBuild).not.toHaveBeenCalled()

    mocks.fetchDefaultModel.mockResolvedValue({ data: builderDefaultModel })
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(mocks.startBuild).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant',
        builderModel,
        true,
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
    await openStarter(user)
    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.starter.chatflowTitle' }),
      'Build an expense assistant',
    )
    await user.click(screen.getByRole('button', { name: 'difyBuilder.messageSend' }))
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
        true,
      ),
    )
    expect(mocks.startBuild).toHaveBeenCalledOnce()
  })
})
