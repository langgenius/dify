import type { AppModelConfigPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ConfigurationViewModel } from '../hooks/configuration-view-model'
import type { AppPublisherProps } from '@/app/components/app/app-publisher/types'
import { zAppModelConfigPayload } from '@dify/contracts/api/console/apps/zod.gen'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CommonLayoutError from '@/app/(commonLayout)/error'
import FeaturesWrappedAppPublisher from '@/app/components/app/app-publisher/features-wrapper'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { useFeatures } from '@/app/components/base/features/hooks'
import { AppToastHost } from '@/app/notifications/host'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { render } from '@/test/console/render'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { AppACLPermission } from '@/utils/permission'
import Configuration from '../index'
import { toast } from '../toast'

const mockRequest = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())
const mockDatasets = vi.hoisted(() => vi.fn())
let appId = 'app-1'

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: (...args: unknown[]) => mockRequest(...args),
  get: (...args: unknown[]) => mockGet(...args),
}))
vi.mock('@/service/datasets', () => ({
  fetchDatasets: (...args: unknown[]) => mockDatasets(...args),
}))
vi.mock('@/next/navigation', () => ({ useParams: () => ({ appId }) }))
vi.mock('nuqs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuqs')>()),
  useQueryState: () => [null, vi.fn()],
}))
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({ workspacePermissionKeys: [] }))
})
vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: { mobile: 'mobile' },
}))
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({}),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    currentModel: { features: [], model_properties: { mode: 'chat' } },
  }),
}))
vi.mock('../debug/hooks', () => ({
  useDebugWithSingleOrMultipleModel: () => ({
    debugWithMultipleModel: false,
    multipleModelConfigs: [],
    handleMultipleModelConfigsChange: vi.fn(),
  }),
  useFormattingChangedDispatcher: () => vi.fn(),
}))
vi.mock('@/app/components/app/app-publisher', () => ({
  AppPublisher: ({ onRestore }: AppPublisherProps) => (
    <button onClick={() => onRestore?.()}>Restore</button>
  ),
}))
function FeaturesProbe() {
  const opening = useFeatures((state) => state.features.opening)
  return <output aria-label="Opening">{opening?.opening_statement}</output>
}
vi.mock('../configuration-view', () => ({
  default: ({ contextValue, appPublisherProps, featuresData }: ConfigurationViewModel) => (
    <>
      <label>
        Prompt
        <input
          value={contextValue.modelConfig.configs.prompt_template}
          onChange={(event) =>
            contextValue.setModelConfig({
              ...contextValue.modelConfig,
              configs: { ...contextValue.modelConfig.configs, prompt_template: event.target.value },
            })
          }
        />
      </label>
      <output aria-label="App">{contextValue.appId}</output>
      <output aria-label="Published at">{appPublisherProps.publishedAt}</output>
      <output aria-label="Datasets">
        {contextValue.modelConfig.dataSets.map(({ id }) => id).join(',')}
      </output>
      <button
        onClick={() => {
          void appPublisherProps.onPublish?.(undefined, featuresData)
        }}
      >
        Publish
      </button>
      <FeaturesProvider features={featuresData}>
        <FeaturesWrappedAppPublisher {...appPublisherProps} />
        <FeaturesProbe />
      </FeaturesProvider>
    </>
  ),
}))

const uploadConfig = {
  attachment_image_file_size_limit: 10,
  audio_file_size_limit: 50,
  batch_count_limit: 5,
  file_size_limit: 15,
  file_upload_limit: 5,
  image_file_batch_limit: 10,
  image_file_size_limit: 10,
  knowledge_file_size_limit: 15,
  single_chunk_attachment_limit: 10,
  skill_file_size_limit: 10,
  video_file_size_limit: 100,
  workflow_file_upload_limit: 10,
}
const createDetail = (id = 'app-1', prompt = 'Saved prompt') =>
  createAppDetailFixture({
    id,
    mode: 'chat',
    permission_keys: [AppACLPermission.Edit, AppACLPermission.ReleaseAndVersion],
    model_config: createAppModelConfigFixture({
      pre_prompt: prompt,
      model: {
        provider: 'langgenius/openai/openai',
        name: 'gpt-4o',
        mode: 'chat',
        completion_params: { temperature: 0.7 },
      },
    }),
  })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function setup() {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  const wrapper = createQueryClientWrapper(queryClient)
  return { user: userEvent.setup(), queryClient, ...render(<Configuration />, { wrapper }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  appId = 'app-1'
  toast.dismiss()
  mockGet.mockResolvedValue([])
  mockDatasets.mockResolvedValue({ data: [] })
  mockRequest.mockImplementation(async (url: string) =>
    Response.json(url.endsWith('/files/upload') ? uploadConfig : createDetail()),
  )
})
afterEach(() => {
  act(() => {
    toast.dismiss()
  })
})

describe('Configuration editing session', () => {
  it('starts independent defaults together and waits for selected datasets before exposing the editor', async () => {
    const details = deferred<Response>()
    const tools = deferred<unknown[]>()
    const upload = deferred<Response>()
    const datasets = deferred<{ data: unknown[] }>()
    mockGet.mockReturnValue(tools.promise)
    mockDatasets.mockReturnValue(datasets.promise)
    mockRequest.mockImplementation((url: string) =>
      url.endsWith('/files/upload') ? upload.promise : details.promise,
    )
    setup()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('/files/upload'),
        expect.anything(),
        expect.anything(),
      ),
    )
    expect(mockGet).toHaveBeenCalledWith('/workspaces/current/tool-providers')
    expect(mockDatasets).not.toHaveBeenCalled()
    const detail = createDetail()
    detail.model_config = createAppModelConfigFixture({
      ...detail.model_config,
      dataset_configs: {
        retrieval_model: 'multiple',
        datasets: { datasets: [{ dataset: { enabled: true, id: 'dataset-1' } }] },
      },
    })
    await act(async () => {
      details.resolve(Response.json(detail))
    })
    await waitFor(() =>
      expect(mockDatasets).toHaveBeenCalledWith({
        url: '/datasets',
        params: { page: 1, ids: ['dataset-1'] },
      }),
    )
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).not.toBeInTheDocument()
    await act(async () => {
      tools.resolve([])
      upload.resolve(Response.json(uploadConfig))
    })
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).not.toBeInTheDocument()
    await act(async () => {
      datasets.resolve({ data: [] })
    })
    expect(await screen.findByRole('textbox', { name: 'Prompt' })).toHaveValue('Saved prompt')
  })

  it('keeps typed input when background metadata refresh changes configured dataset IDs', async () => {
    const { queryClient, user } = setup()
    await user.clear(await screen.findByRole('textbox', { name: 'Prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'My draft')
    const refreshed = createDetail('app-1', 'Different server prompt')
    refreshed.model_config = createAppModelConfigFixture({
      ...refreshed.model_config,
      updated_at: 123,
      opening_statement: 'Latest opening',
      dataset_configs: {
        retrieval_model: 'multiple',
        datasets: { datasets: [{ dataset: { id: 'new-dataset', enabled: true } }] },
      },
    })
    mockRequest.mockImplementation(async (url: string) =>
      Response.json(url.endsWith('/files/upload') ? uploadConfig : refreshed),
    )
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.get.queryKey({
          input: { params: { app_id: 'app-1' } },
        }),
      })
    })
    expect(screen.getByLabelText('Prompt')).toHaveValue('My draft')
    await waitFor(() => expect(screen.getByLabelText('Published at')).toHaveTextContent('123000'))
    expect(mockDatasets).not.toHaveBeenCalled()
    const datasets = deferred<{ data: { id: string; name: string }[] }>()
    mockDatasets.mockReturnValueOnce(datasets.promise)
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))
    await waitFor(() =>
      expect(mockDatasets).toHaveBeenCalledWith({
        url: '/datasets',
        params: { page: 1, ids: ['new-dataset'] },
      }),
    )
    expect(screen.getByLabelText('Prompt')).toHaveValue('My draft')
    expect(screen.getByLabelText('Datasets')).toBeEmptyDOMElement()
    expect(screen.getByLabelText('Opening')).toBeEmptyDOMElement()
    await act(async () => datasets.resolve({ data: [{ id: 'new-dataset', name: 'New dataset' }] }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue(
        'Different server prompt',
      ),
    )
    expect(screen.getByLabelText('Datasets')).toHaveTextContent('new-dataset')
    expect(screen.getByLabelText('Opening')).toHaveTextContent('Latest opening')
  })

  it('keeps edits made while publishing and explicitly restores the latest server snapshot', async () => {
    const published = deferred<Response>()
    let submitted: AppModelConfigPayload | undefined
    let latest = createDetail()
    mockRequest.mockImplementation(
      async (url: string, _init: RequestInit, options: { request: Request }) => {
        if (url.endsWith('/model-config')) {
          submitted = zAppModelConfigPayload.parse(await options.request.json())
          return published.promise
        }
        return Response.json(url.endsWith('/files/upload') ? uploadConfig : latest)
      },
    )
    const { user } = setup()
    await user.clear(await screen.findByRole('textbox', { name: 'Prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Submitted prompt')
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(submitted?.pre_prompt).toBe('Submitted prompt'))
    await user.clear(screen.getByRole('textbox', { name: 'Prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Continued editing')
    latest = createDetail('app-1', 'Submitted prompt')
    latest.model_config = createAppModelConfigFixture({ ...latest.model_config, updated_at: 456 })
    await act(async () => {
      published.resolve(Response.json({ result: 'success' }))
    })
    await waitFor(() => expect(screen.getByLabelText('Published at')).toHaveTextContent('456000'))
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Continued editing')
    expect(screen.getByLabelText('Published at')).toHaveTextContent('456000')
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Submitted prompt'),
    )
  })

  it('creates a new draft when navigating to another app', async () => {
    const { rerender } = setup()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'App A draft' },
    })
    appId = 'app-2'
    mockRequest.mockImplementation(async (url: string) =>
      Response.json(
        url.endsWith('/files/upload') ? uploadConfig : createDetail('app-2', 'App B saved prompt'),
      ),
    )
    rerender(<Configuration />)
    expect(await screen.findByDisplayValue('App B saved prompt')).toBeInTheDocument()
    expect(screen.getByLabelText('App')).toHaveTextContent('app-2')
  })

  it('keeps the current editor when a background defaults request fails', async () => {
    const { queryClient } = setup()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'My draft' },
    })
    mockGet.mockRejectedValue(new Error('Tools are temporarily unavailable'))
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['tools', 'allToolProviders'] })
    })
    expect(screen.getByLabelText('Prompt')).toHaveValue('My draft')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('rejects Restore when fresh tool loading fails despite cached tools and retries successfully', async () => {
    const { user } = setup()
    await user.clear(await screen.findByRole('textbox', { name: 'Prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'My draft')
    mockRequest.mockImplementation(async (url: string) =>
      Response.json(
        url.endsWith('/files/upload') ? uploadConfig : createDetail('app-1', 'Latest prompt'),
      ),
    )
    mockGet.mockRejectedValue(new Error('Tools unavailable'))
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))
    expect(await screen.findByText('common.api.actionFailed')).toBeInTheDocument()
    expect(screen.getByLabelText('Prompt')).toHaveValue('My draft')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    mockGet.mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Latest prompt'),
    )
  })

  it('does not apply an earlier app publication to the newly opened app', async () => {
    const published = deferred<Response>()
    const { queryClient, rerender } = setup()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'App A submitted prompt' },
    })
    mockRequest.mockImplementation(async (url: string) => {
      if (url.endsWith('/model-config')) return published.promise
      return Response.json(createDetail('app-2', 'App B saved prompt'))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('/apps/app-1/model-config'),
        expect.anything(),
        expect.anything(),
      ),
    )
    appId = 'app-2'
    rerender(<Configuration />)
    fireEvent.change(await screen.findByDisplayValue('App B saved prompt'), {
      target: { value: 'App B draft' },
    })
    await act(async () => {
      published.resolve(Response.json({ result: 'success' }))
    })
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('App B draft')
    expect(screen.getByLabelText('App')).toHaveTextContent('app-2')
  })

  it('surfaces missing model configuration instead of leaving a loading screen', async () => {
    mockRequest.mockImplementation(async (url: string) =>
      Response.json(
        url.endsWith('/files/upload')
          ? uploadConfig
          : createAppDetailFixture({ model_config: null }),
      ),
    )
    const queryClient = createTestQueryClient()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <ErrorBoundary fallback={(error) => <div role="alert">{error.message}</div>}>
          <Configuration />
        </ErrorBoundary>,
        { wrapper: createQueryClientWrapper(queryClient) },
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'App app-1 has no model configuration',
      )
    } finally {
      report.mockRestore()
    }
  })

  it('preserves an unauthorized defaults response for the existing redirect fallback', async () => {
    const response = new Response(null, { status: 401 })
    mockGet.mockRejectedValue(response)
    const queryClient = createTestQueryClient()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn()
    try {
      render(
        <ErrorBoundary
          onError={onError}
          fallback={(error) => <CommonLayoutError error={error} retry={vi.fn()} />}
        >
          <Configuration />
        </ErrorBoundary>,
        { wrapper: createQueryClientWrapper(queryClient) },
      )
      await waitFor(() => expect(onError).toHaveBeenCalledWith(response, expect.anything()))
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    } finally {
      report.mockRestore()
    }
  })

  it('renders configuration notifications in its offset viewport', async () => {
    const queryClient = createTestQueryClient()
    seedAccountProfileQuery(queryClient, { id: 'user-1' })
    render(
      <>
        <AppToastHost />
        <Configuration />
      </>,
      { wrapper: createQueryClientWrapper(queryClient) },
    )
    await screen.findByRole('textbox', { name: 'Prompt' })
    act(() => {
      toast.error('Configuration error')
    })
    const toastItem = await screen.findByText('Configuration error')
    const viewport = toastItem.closest<HTMLElement>('[role="region"]')
    expect(viewport).toHaveStyle({ top: '60px' })
    const globalViewport = screen
      .getAllByRole('region', { name: 'Notifications' })
      .find((region) => region !== viewport)
    expect(globalViewport).not.toHaveTextContent('Configuration error')
  })
})
