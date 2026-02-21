import type { TryAppInfo } from '@/service/try-app'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TryApp from '../index'
import { TypeEnum } from '../tab'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal() as object
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

const mockUseGetTryAppInfo = vi.fn()

vi.mock('@/service/use-try-app', () => ({
  useGetTryAppInfo: (...args: unknown[]) => mockUseGetTryAppInfo(...args),
}))

vi.mock('../app', () => ({
  default: ({ appId, appDetail }: { appId: string, appDetail: TryAppInfo }) => (
    <div data-testid="app-component" data-app-id={appId} data-mode={appDetail?.mode}>
      App Component
    </div>
  ),
}))

vi.mock('../preview', () => ({
  default: ({ appId, appDetail }: { appId: string, appDetail: TryAppInfo }) => (
    <div data-testid="preview-component" data-app-id={appId} data-mode={appDetail?.mode}>
      Preview Component
    </div>
  ),
}))

vi.mock('../app-info', () => ({
  default: ({
    appId,
    appDetail,
    category,
    className,
    onCreate,
  }: { appId: string, appDetail: TryAppInfo, category?: string, className?: string, onCreate: () => void }) => (
    <div
      data-testid="app-info-component"
      data-app-id={appId}
      data-category={category}
      className={className}
    >
      <button data-testid="create-button" onClick={onCreate}>Create</button>
      App Info:
      {' '}
      {appDetail?.name}
    </div>
  ),
}))

const createMockAppDetail = (mode: string = 'chat'): TryAppInfo => ({
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
} as unknown as TryAppInfo)

describe('TryApp (main index.tsx)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      expect(document.body.querySelector('[role="status"]')).toBeInTheDocument()
    })
  })

  describe('content rendering', () => {
    it('renders Tab component', async () => {
      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('explore.tryApp.tabHeader.try')).toBeInTheDocument()
        expect(screen.getByText('explore.tryApp.tabHeader.detail')).toBeInTheDocument()
      })
    })

    it('renders App component by default (TRY mode)', async () => {
      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(document.body.querySelector('[data-testid="app-component"]')).toBeInTheDocument()
        expect(document.body.querySelector('[data-testid="preview-component"]')).not.toBeInTheDocument()
      })
    })

    it('renders AppInfo component', async () => {
      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(document.body.querySelector('[data-testid="app-info-component"]')).toBeInTheDocument()
      })
    })

    it('renders close button', async () => {
      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        const buttons = document.body.querySelectorAll('button')
        expect(buttons.length).toBeGreaterThan(0)
      })
    })
  })

  describe('tab switching', () => {
    it('switches to Preview when Detail tab is clicked', async () => {
      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('explore.tryApp.tabHeader.detail')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('explore.tryApp.tabHeader.detail'))

      await waitFor(() => {
        expect(document.body.querySelector('[data-testid="preview-component"]')).toBeInTheDocument()
        expect(document.body.querySelector('[data-testid="app-component"]')).not.toBeInTheDocument()
      })
    })

    it('switches back to App when Try tab is clicked', async () => {
      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('explore.tryApp.tabHeader.detail')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('explore.tryApp.tabHeader.detail'))

      await waitFor(() => {
        expect(document.body.querySelector('[data-testid="preview-component"]')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('explore.tryApp.tabHeader.try'))

      await waitFor(() => {
        expect(document.body.querySelector('[data-testid="app-component"]')).toBeInTheDocument()
      })
    })
  })

  describe('close functionality', () => {
    it('calls onClose when close button is clicked', async () => {
      const mockOnClose = vi.fn()

      render(
        <TryApp
          appId="test-app-id"
          onClose={mockOnClose}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        const buttons = document.body.querySelectorAll('button')
        const closeButton = Array.from(buttons).find(btn =>
          btn.querySelector('svg') || btn.className.includes('rounded-[10px]'),
        )
        expect(closeButton).toBeInTheDocument()

        if (closeButton)
          fireEvent.click(closeButton)
      })

      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('create functionality', () => {
    it('calls onCreate when create button in AppInfo is clicked', async () => {
      const mockOnCreate = vi.fn()

      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={mockOnCreate}
        />,
      )

      await waitFor(() => {
        const createButton = document.body.querySelector('[data-testid="create-button"]')
        expect(createButton).toBeInTheDocument()

        if (createButton)
          fireEvent.click(createButton)
      })

      expect(mockOnCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('category prop', () => {
    it('passes category to AppInfo when provided', async () => {
      render(
        <TryApp
          appId="test-app-id"
          category="AI Assistant"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        const appInfo = document.body.querySelector('[data-testid="app-info-component"]')
        expect(appInfo).toHaveAttribute('data-category', 'AI Assistant')
      })
    })

    it('does not pass category to AppInfo when not provided', async () => {
      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        const appInfo = document.body.querySelector('[data-testid="app-info-component"]')
        expect(appInfo).not.toHaveAttribute('data-category', expect.any(String))
      })
    })
  })

  describe('hook calls', () => {
    it('calls useGetTryAppInfo with correct appId', () => {
      render(
        <TryApp
          appId="my-specific-app-id"
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
          appId="my-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

      await waitFor(() => {
        const appComponent = document.body.querySelector('[data-testid="app-component"]')
        expect(appComponent).toHaveAttribute('data-app-id', 'my-app-id')
      })
    })

    it('passes appId to Preview component when in Detail mode', async () => {
      render(
        <TryApp
          appId="my-app-id"
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
          appId="my-app-id"
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
      render(
        <TryApp
          appId="test-app-id"
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />,
      )

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
