import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { ComponentProps } from 'react'
import type { TryAppInfo } from '@/service/try-app'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import TryAppComponent from '../index'
import { TypeEnum } from '../types'

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

const mockUseGetTryAppInfo = vi.fn()
const mockPreviewSuspension = vi.hoisted(() => ({ promise: null as Promise<void> | null }))

vi.mock('@/service/use-try-app', () => ({
  useGetTryAppInfo: (...args: unknown[]) => mockUseGetTryAppInfo(...args),
}))

vi.mock('../app', () => ({
  default: ({ appId, appDetail }: { appId: string; appDetail: TryAppInfo }) => (
    <div data-testid="app-component" data-app-id={appId} data-mode={appDetail?.mode}>
      App Component
    </div>
  ),
}))

vi.mock('../preview', () => ({
  default: ({ appId, appDetail }: { appId: string; appDetail: TryAppInfo }) => {
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
    appDetail: TryAppInfo
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

const createMockAppDetail = (mode: string = 'chat'): TryAppInfo =>
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
  }) as unknown as TryAppInfo

describe('TryApp (main index.tsx)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPreviewSuspension.promise = null
    // Suppress expected React act() warnings from internal async state updates
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUseGetTryAppInfo.mockReturnValue({
      data: createMockAppDetail(),
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('loading state', () => {
    it('renders loading when isLoading is true', () => {
      mockUseGetTryAppInfo.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      expect(screen.queryByRole('progressbar')).toBeInTheDocument()
    })

    it('keeps the dialog and tabs mounted when the initial load finishes', () => {
      let result = { data: null as TryAppInfo | null, isLoading: true }
      mockUseGetTryAppInfo.mockImplementation(() => result)
      const { rerender } = render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)
      const dialog = screen.getByRole('dialog')
      const detailTab = screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })
      const tryTab = screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.try' })
      expect(tryTab).toHaveAttribute('aria-disabled', 'true')

      result = { data: createMockAppDetail(), isLoading: false }
      rerender(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })).toBe(detailTab)
      expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.try' })).toBe(tryTab)
      expect(tryTab).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('keeps the tabs mounted when the initial load fails', () => {
      let result = { data: null, isLoading: true, isError: false, refetch: vi.fn() }
      mockUseGetTryAppInfo.mockImplementation(() => result)
      const { rerender } = render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)
      const detailTab = screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })

      result = { ...result, isLoading: false, isError: true }
      rerender(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })).toBe(detailTab)
      expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeInTheDocument()
    })

    it('keeps the dialog visible while preview content suspends', async () => {
      let resolvePreview: () => void = () => {}
      mockPreviewSuspension.promise = new Promise<void>((resolve) => {
        resolvePreview = resolve
      })
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      const dialog = screen.getByRole('dialog')
      const detailTab = screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.try' })).toBeInTheDocument()

      await act(async () => {
        mockPreviewSuspension.promise = null
        resolvePreview()
      })

      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })).toBe(detailTab)
      expect(screen.getByTestId('preview-component')).toBeInTheDocument()
    })

    it('shows retry without the create panel when the app detail request fails', () => {
      mockUseGetTryAppInfo.mockReturnValue({
        data: null,
        isError: true,
        isFetching: false,
        refetch: vi.fn(),
      })

      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      expect(screen.getByText('explore.tryApp.loadError')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeEnabled()
      expect(screen.queryByTestId('app-info-component')).not.toBeInTheDocument()
      expect(screen.queryByTestId('create-button')).not.toBeInTheDocument()
    })

    it('renders unknown unavailable state when app detail is empty', () => {
      mockUseGetTryAppInfo.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      })

      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      expect(screen.getByText('explore.tryApp.loadError')).toBeInTheDocument()
    })

    it('disables retry while fetching and restores the full preview after recovery', async () => {
      const refetch = vi.fn().mockResolvedValue({ data: createMockAppDetail() })
      let result = {
        data: null as TryAppInfo | null,
        isLoading: false,
        isError: true,
        isFetching: false,
        refetch,
      }
      mockUseGetTryAppInfo.mockImplementation(() => result)
      const { rerender } = render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      const retryButton = screen.getByRole('button', { name: 'common.operation.retry' })
      retryButton.focus()
      fireEvent.click(retryButton)
      expect(refetch).toHaveBeenCalledTimes(1)

      result = { ...result, isFetching: true }
      rerender(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)
      const retryingButton = screen.getByRole('button', { name: 'explore.tryApp.retrying' })
      expect(retryingButton).toHaveAttribute('aria-disabled', 'true')
      expect(retryingButton).toHaveFocus()
      fireEvent.click(retryingButton)
      expect(refetch).toHaveBeenCalledTimes(1)

      result = { ...result, data: createMockAppDetail(), isError: false, isFetching: false }
      rerender(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)
      expect(screen.getByTestId('preview-component')).toBeInTheDocument()
      expect(screen.getByTestId('create-button')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })).toHaveFocus()
      })
    })

    it('allows another retry after a failed request', () => {
      const refetch = vi.fn().mockResolvedValue({ data: null })
      mockUseGetTryAppInfo.mockReturnValue({
        data: null,
        isLoading: false,
        isError: true,
        isFetching: false,
        refetch,
      })
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))
      expect(refetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('content rendering', () => {
    it('defaults to details even when the app can be tried', async () => {
      const app: RecommendedAppResponse = { app_id: 'test-app-id', can_trial: true }

      render(<TryApp app={app} onClose={vi.fn()} onCreate={vi.fn()} />)

      expect(await screen.findByTestId('preview-component')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    it('hides trial when the app is ineligible', async () => {
      const app: RecommendedAppResponse = { app_id: 'test-app-id', can_trial: false }

      render(<TryApp app={app} onClose={vi.fn()} onCreate={vi.fn()} />)

      expect(await screen.findByTestId('preview-component')).toBeInTheDocument()
      expect(
        screen.queryByRole('tab', { name: 'explore.tryApp.tabHeader.try' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByTestId('app-component')).not.toBeInTheDocument()
    })

    it('renders Tab component', async () => {
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByText('explore.tryApp.tabHeader.try')).toBeInTheDocument()
        expect(screen.getByText('explore.tryApp.tabHeader.detail')).toBeInTheDocument()
      })
    })

    it('renders Preview component by default (DETAIL mode)', async () => {
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      await waitFor(() => {
        expect(document.body.querySelector('[data-testid="preview-component"]')).toBeInTheDocument()
        expect(document.body.querySelector('[data-testid="app-component"]')).not.toBeInTheDocument()
      })
      expect(screen.getByRole('dialog', { name: 'Test App Name' })).toBeInTheDocument()
    })

    it('names the dialog after the current template in all load states', () => {
      const app: RecommendedAppResponse = {
        ...defaultApp,
        app: { id: 'test-app-id', name: 'Sample template', icon_url: null },
      }
      const { rerender } = render(<TryApp app={app} onClose={vi.fn()} onCreate={vi.fn()} />)
      expect(screen.getByRole('dialog', { name: 'Sample template' })).toBeInTheDocument()

      mockUseGetTryAppInfo.mockReturnValue({ data: null, isLoading: true })
      rerender(<TryApp app={app} onClose={vi.fn()} onCreate={vi.fn()} />)
      expect(screen.getByRole('dialog', { name: 'Sample template' })).toBeInTheDocument()

      mockUseGetTryAppInfo.mockReturnValue({ data: null, isError: true, refetch: vi.fn() })
      rerender(<TryApp app={app} onClose={vi.fn()} onCreate={vi.fn()} />)
      expect(screen.getByRole('dialog', { name: 'Sample template' })).toBeInTheDocument()
    })

    it('renders AppInfo component', async () => {
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      await waitFor(() => {
        expect(
          document.body.querySelector('[data-testid="app-info-component"]'),
        ).toBeInTheDocument()
      })
    })

    it('renders close button', async () => {
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
      })
    })
  })

  describe('tab switching', () => {
    it('places Details before Try it in tab order', () => {
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'explore.tryApp.tabHeader.detail',
        'explore.tryApp.tabHeader.try',
      ])
    })

    it('switches to Try it and back to Details', async () => {
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      fireEvent.click(screen.getByText('explore.tryApp.tabHeader.try'))

      await waitFor(() => {
        expect(document.body.querySelector('[data-testid="app-component"]')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('explore.tryApp.tabHeader.detail'))

      expect(document.body.querySelector('[data-testid="preview-component"]')).toBeInTheDocument()
    })
  })

  describe('close functionality', () => {
    it('calls onClose when close button is clicked', async () => {
      const mockOnClose = vi.fn()

      render(<TryApp onClose={mockOnClose} onCreate={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('calls onClose when the dialog requests close', async () => {
      const mockOnClose = vi.fn()

      render(<TryApp onClose={mockOnClose} onCreate={vi.fn()} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('create functionality', () => {
    it('calls onCreate when create button in AppInfo is clicked', async () => {
      const mockOnCreate = vi.fn()

      render(<TryApp onClose={vi.fn()} onCreate={mockOnCreate} />)

      await waitFor(() => {
        const createButton = document.body.querySelector('[data-testid="create-button"]')
        expect(createButton).toBeInTheDocument()

        if (createButton) fireEvent.click(createButton)
      })

      expect(mockOnCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('catalog categories', () => {
    it('uses the selected catalog app categories', async () => {
      render(
        <TryApp
          app={{ ...defaultApp, categories: ['AI Assistant', 'Workflow'] }}
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        const appInfo = document.body.querySelector('[data-testid="app-info-component"]')
        expect(appInfo).toHaveAttribute('data-categories', 'AI Assistant,Workflow')
      })
    })

    it('uses an empty category list when the catalog does not provide categories', async () => {
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      await waitFor(() => {
        const appInfo = document.body.querySelector('[data-testid="app-info-component"]')
        expect(appInfo).toHaveAttribute('data-categories', '')
      })
    })
  })

  describe('hook calls', () => {
    it('requests the canonical catalog app ID when nested metadata has another ID', () => {
      render(
        <TryApp
          app={{
            ...defaultApp,
            app_id: 'my-specific-app-id',
            app: { id: 'different-nested-id', icon_url: null },
          }}
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      expect(mockUseGetTryAppInfo).toHaveBeenCalledWith('my-specific-app-id')
    })
  })

  describe('props passing', () => {
    it('passes appId to App component', async () => {
      render(
        <TryApp
          app={{ ...defaultApp, app_id: 'my-app-id' }}
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.try' }))

      await waitFor(() => {
        const appComponent = document.body.querySelector('[data-testid="app-component"]')
        expect(appComponent).toHaveAttribute('data-app-id', 'my-app-id')
      })
    })

    it('passes appId to Preview component when in Detail mode', async () => {
      render(
        <TryApp
          app={{ ...defaultApp, app_id: 'my-app-id' }}
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('explore.tryApp.tabHeader.detail')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('explore.tryApp.tabHeader.detail'))

      await waitFor(() => {
        const previewComponent = document.body.querySelector('[data-testid="preview-component"]')
        expect(previewComponent).toHaveAttribute('data-app-id', 'my-app-id')
      })
    })

    it('passes appId to AppInfo component', async () => {
      render(
        <TryApp
          app={{ ...defaultApp, app_id: 'my-app-id' }}
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        const appInfoComponent = document.body.querySelector('[data-testid="app-info-component"]')
        expect(appInfoComponent).toHaveAttribute('data-app-id', 'my-app-id')
      })
    })

    it('passes appDetail to AppInfo component', async () => {
      render(<TryApp onClose={vi.fn()} onCreate={vi.fn()} />)

      await waitFor(() => {
        const appInfoComponent = document.body.querySelector('[data-testid="app-info-component"]')
        expect(appInfoComponent?.textContent).toContain('Test App Name')
      })
    })
  })

  describe('TypeEnum export', () => {
    it('exports TypeEnum correctly', () => {
      expect(TypeEnum.TRY).toBe('try')
      expect(TypeEnum.DETAIL).toBe('detail')
    })
  })
})
