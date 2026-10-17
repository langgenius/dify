import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { TrialAppDetailResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import TryAppComponent from '../index'

function render(ui: ReactElement, queryClient = createConsoleQueryClient()) {
  return rtlRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

const defaultApp: RecommendedAppResponse = { app_id: 'test-app-id', can_trial: true }

function TryApp({
  app = defaultApp,
  ...props
}: Omit<
  ComponentProps<typeof TryAppComponent>,
  'appId' | 'canTrial' | 'categories' | 'templateName'
> & {
  app?: RecommendedAppResponse
}) {
  return (
    <TryAppComponent
      {...props}
      appId={app.app_id}
      canTrial={app.can_trial}
      categories={app.categories}
      templateName={app.app?.name}
    />
  )
}

const getDetail = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'trialApps.byAppId.get': (input: { params: { app_id: string } }) =>
        getDetail(input.params.app_id),
    }),
  }
})
const mockPreviewSuspension = vi.hoisted(() => ({ promise: null as Promise<void> | null }))

vi.mock('../app', () => ({
  default: ({ appId, appDetail }: { appId: string; appDetail: TrialAppDetailResponse }) => (
    <div data-testid="app-component" data-app-id={appId} data-mode={appDetail?.mode}>
      App Component
    </div>
  ),
}))

vi.mock('../preview', () => ({
  default: ({ appId, appDetail }: { appId: string; appDetail: TrialAppDetailResponse }) => {
    if (mockPreviewSuspension.promise) throw mockPreviewSuspension.promise
    return (
      <div data-testid="preview-component" data-app-id={appId} data-mode={appDetail?.mode}>
        Preview Component
      </div>
    )
  },
}))

vi.mock('../app-info', () => ({
  default: ({
    appId,
    appDetail,
    categories,
    className,
    onCreate,
  }: {
    appId: string
    appDetail: TrialAppDetailResponse
    categories?: string[]
    className?: string
    onCreate: () => void
  }) => (
    <div
      data-testid="app-info-component"
      data-app-id={appId}
      data-categories={categories?.join(',')}
      className={className}
    >
      <button data-testid="create-button" onClick={onCreate}>
        Create
      </button>
      App Info: {appDetail?.name}
    </div>
  ),
}))

const createMockAppDetail = (mode: string = 'chat'): TrialAppDetailResponse =>
  ({
    id: 'test-app-id',
    name: 'Test App Name',
    description: 'Test Description',
    mode,
    site: {
      title: 'Test Site Title',
      icon: '🚀',
      icon_type: 'emoji',
      icon_background: '#FFFFFF',
      icon_url: '',
    },
    model_config: {
      model: {
        provider: 'langgenius/openai/openai',
        name: 'gpt-4',
        mode: 'chat',
      },
      dataset_configs: {
        datasets: {
          datasets: [],
        },
      },
      agent_mode: {
        tools: [],
      },
      user_input_form: [],
    },
  }) as unknown as TrialAppDetailResponse

describe('TryApp', () => {
  beforeEach(() => {
    mockPreviewSuspension.promise = null
    getDetail.mockReset().mockResolvedValue(createMockAppDetail())
  })

  it('keeps the dialog and tabs mounted while the initial request settles', async () => {
    const request = createDeferred<TrialAppDetailResponse>()
    getDetail.mockReturnValue(request.promise)
    render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)
    const detailTab = screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })
    const tryTab = screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.try' })
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(tryTab).toHaveAttribute('aria-disabled', 'true')
    await act(async () => request.resolve(createMockAppDetail()))
    expect(await screen.findByTestId('preview-component')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })).toBeVisible()
    expect(tryTab).not.toHaveAttribute('aria-disabled', 'true')
    expect(detailTab).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the tabs and template name when the request fails and hides creation', async () => {
    const request = createDeferred<TrialAppDetailResponse>()
    getDetail.mockReturnValue(request.promise)
    const app = {
      ...defaultApp,
      app: { id: 'test-app-id', name: 'Sample template', icon_url: null },
    }
    render(<TryApp app={app} onClose={vi.fn()} onCreate={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Sample template' })).toBeInTheDocument()
    await act(async () => request.reject(new Error('Unavailable')))
    expect(await screen.findByRole('button', { name: 'common.operation.retry' })).toBeEnabled()
    expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })).toBeVisible()
    expect(screen.getByRole('dialog', { name: 'Sample template' })).toBeInTheDocument()
    expect(screen.queryByTestId('app-info-component')).not.toBeInTheDocument()
    expect(screen.queryByTestId('create-button')).not.toBeInTheDocument()
  })

  it('starts a reopened dialog with loading even after a cached failure', async () => {
    const client = createConsoleQueryClient()
    getDetail.mockRejectedValueOnce(new Error('Unavailable'))
    const first = render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />, client)
    await screen.findByRole('button', { name: 'common.operation.retry' })
    first.unmount()
    const request = createDeferred<TrialAppDetailResponse>()
    getDetail.mockReturnValue(request.promise)
    render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />, client)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
    await act(async () => request.reject(new Error('Still unavailable')))
    expect(await screen.findByRole('button', { name: 'common.operation.retry' })).toBeEnabled()
  })

  it('keeps the dialog visible while preview content suspends', async () => {
    const request = createDeferred<void>()
    mockPreviewSuspension.promise = request.promise
    render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)
    await screen.findByTestId('app-info-component')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await act(async () => {
      mockPreviewSuspension.promise = null
      request.resolve()
    })
    expect(await screen.findByTestId('preview-component')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the error block during retry, prevents duplicate requests and restores preview and focus', async () => {
    const user = userEvent.setup()
    const request = createDeferred<TrialAppDetailResponse>()
    getDetail.mockRejectedValueOnce(new Error('Unavailable')).mockReturnValue(request.promise)
    render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)
    const retryButton = await screen.findByRole('button', { name: 'common.operation.retry' })
    await user.click(retryButton)
    const retryingButton = await screen.findByRole('button', { name: 'explore.tryApp.retrying' })
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(retryingButton).toHaveAttribute('aria-disabled', 'true')
    expect(retryingButton).toHaveFocus()
    await user.click(retryingButton)
    expect(getDetail).toHaveBeenCalledTimes(2)
    await act(async () => request.resolve(createMockAppDetail()))
    expect(await screen.findByTestId('preview-component')).toBeInTheDocument()
    expect(screen.getByTestId('create-button')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })).toHaveFocus(),
    )
  })

  it('allows another retry after a failed retry', async () => {
    const user = userEvent.setup()
    getDetail
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockRejectedValueOnce(new Error('Still unavailable'))
    render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)
    const retryButton = await screen.findByRole('button', { name: 'common.operation.retry' })
    await user.click(retryButton)
    await waitFor(() => expect(getDetail).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeEnabled(),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByTestId('preview-component')).toBeInTheDocument()
    expect(getDetail).toHaveBeenCalledTimes(3)
  })

  it('hides trial for ineligible apps', async () => {
    render(
      <TryApp app={{ ...defaultApp, can_trial: false }} onClose={vi.fn()} onCreate={vi.fn()} />,
    )
    await screen.findByTestId('preview-component')
    expect(
      screen.queryByRole('tab', { name: 'explore.tryApp.tabHeader.try' }),
    ).not.toBeInTheDocument()
  })

  it('switches between details and trial after loading the canonical catalog app', async () => {
    const user = userEvent.setup()
    render(
      <TryApp
        app={{
          ...defaultApp,
          app_id: 'my-specific-app-id',
          app: { id: 'different-id', icon_url: null },
        }}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    )
    await screen.findByTestId('preview-component')
    expect(getDetail).toHaveBeenCalledWith('my-specific-app-id')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'explore.tryApp.tabHeader.detail',
      'explore.tryApp.tabHeader.try',
    ])
    await user.click(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.try' }))
    expect(await screen.findByTestId('app-component')).toHaveAttribute(
      'data-app-id',
      'my-specific-app-id',
    )
    await user.click(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' }))
    expect(await screen.findByTestId('preview-component')).toHaveAttribute(
      'data-app-id',
      'my-specific-app-id',
    )
  })

  it('calls onClose from the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TryApp onClose={onClose} onCreate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the dialog receives Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TryApp onClose={onClose} onCreate={vi.fn()} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('creates from the loaded template and passes catalog categories to app info', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(
      <TryApp
        app={{ ...defaultApp, categories: ['AI Assistant', 'Workflow'] }}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    )
    expect(await screen.findByTestId('app-info-component')).toHaveAttribute(
      'data-categories',
      'AI Assistant,Workflow',
    )
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenCalledOnce()
  })
})
