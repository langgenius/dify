import type { ReactNode } from 'react'
import type { App } from '@/models/explore'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useContextSelector } from 'use-context-selector'
import AppListContext from '@/context/app-list-context'
import { fetchAppDetail } from '@/service/explore'
import { AppModeEnum } from '@/types/app'
import Apps from '../index'

vi.mock('@/next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    const LazyComp = React.lazy(loader)
    return function DynamicWrapper(props: Record<string, unknown>) {
      return React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(LazyComp, props),
      )
    }
  },
}))

let documentTitleCalls: string[] = []
let educationInitCalls: number = 0
const mockHandleImportDSL = vi.fn()
const mockHandleImportDSLConfirm = vi.fn()
const mockTrackCreateApp = vi.fn()
const mockFetchAppDetail = vi.mocked(fetchAppDetail)

const mockTemplateApp: App = {
  app_id: 'template-1',
  categories: ['Assistant'],
  app: {
    id: 'template-1',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#fff',
    icon_url: '',
    name: 'Sample App',
    description: 'Sample App',
    use_icon_as_answer_icon: false,
  },
  description: 'Sample App',
  can_trial: true,
  copyright: '',
  privacy_policy: null,
  custom_disclaimer: null,
  position: 1,
  is_listed: true,
  install_count: 0,
  installed: false,
  editable: false,
  is_agent: false,
}

vi.mock('@/hooks/use-document-title', () => ({
  default: (title: string) => {
    documentTitleCalls.push(title)
  },
}))

vi.mock('@/app/education-apply/hooks', () => ({
  useEducationInit: () => {
    educationInitCalls++
  },
}))

vi.mock('@/hooks/use-import-dsl', () => ({
  useImportDSL: () => ({
    handleImportDSL: mockHandleImportDSL,
    handleImportDSLConfirm: mockHandleImportDSLConfirm,
    versions: [],
    isFetching: false,
  }),
}))

const mockReplace = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
}))

vi.mock('../list', () => {
  const MockList = () => {
    const setShowTryAppPanel = useContextSelector(AppListContext, ctx => ctx.setShowTryAppPanel)
    return React.createElement(
      'div',
      { 'data-testid': 'apps-list' },
      React.createElement('span', null, 'Apps List'),
      React.createElement(
        'button',
        {
          'data-testid': 'open-preview',
          'onClick': () => setShowTryAppPanel(true, {
            appId: mockTemplateApp.app_id,
            app: mockTemplateApp,
          }),
        },
        'Open Preview',
      ),
    )
  }

  return { default: MockList }
})

vi.mock('../../explore/try-app', () => ({
  default: ({ onCreate, onClose }: { onCreate: () => void, onClose: () => void }) => (
    <div data-testid="try-app-panel">
      <button data-testid="try-app-create" onClick={onCreate}>Create</button>
      <button data-testid="try-app-close" onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('../../explore/create-app-modal', () => ({
  default: ({ show, onConfirm, onHide }: { show: boolean, onConfirm: (payload: Record<string, string>) => Promise<void>, onHide: () => void }) => show
    ? (
        <div data-testid="create-app-modal">
          <button
            data-testid="confirm-create"
            onClick={() => onConfirm({
              name: 'Created App',
              icon_type: 'emoji',
              icon: '🤖',
              icon_background: '#fff',
              description: 'created from preview',
            })}
          >
            Confirm
          </button>
          <button data-testid="hide-create" onClick={onHide}>Hide</button>
        </div>
      )
    : null,
}))

vi.mock('../../app/create-from-dsl-modal/dsl-confirm-modal', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: () => void, onCancel: () => void }) => (
    <div data-testid="dsl-confirm-modal">
      <button data-testid="confirm-dsl" onClick={onConfirm}>Confirm DSL</button>
      <button data-testid="cancel-dsl" onClick={onCancel}>Cancel DSL</button>
    </div>
  ),
}))

vi.mock('../import-from-marketplace-template-modal', () => ({
  default: ({ templateId, onClose, onConfirm }: { templateId: string, onClose: () => void, onConfirm: (dsl: string) => void }) => (
    <div data-testid="marketplace-template-modal">
      <span data-testid="template-id">{templateId}</span>
      <button data-testid="close-template" onClick={onClose}>Close Template</button>
      <button data-testid="confirm-template" onClick={() => onConfirm('yaml-dsl-content')}>Confirm Template</button>
    </div>
  ),
}))

vi.mock('@/service/explore', () => ({
  fetchAppDetail: vi.fn(),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: (...args: unknown[]) => mockTrackCreateApp(...args),
}))

describe('Apps', () => {
  const createQueryClient = () => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  const renderWithClient = (ui: React.ReactElement) => {
    const queryClient = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    return {
      queryClient,
      ...render(ui, { wrapper }),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    documentTitleCalls = []
    educationInitCalls = 0
    mockSearchParams = new URLSearchParams()
    mockReplace.mockClear()
    mockFetchAppDetail.mockResolvedValue({
      id: 'template-1',
      name: 'Sample App',
      icon: '🤖',
      icon_background: '#fff',
      mode: AppModeEnum.CHAT,
      export_data: 'yaml-content',
    })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderWithClient(<Apps />)
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()
    })

    it('should render List component', () => {
      renderWithClient(<Apps />)
      expect(screen.getByText('Apps List')).toBeInTheDocument()
    })

    it('should have correct container structure', () => {
      const { container } = renderWithClient(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('relative', 'flex', 'h-0', 'shrink-0', 'grow', 'flex-col')
    })
  })

  describe('Hooks', () => {
    it('should call useDocumentTitle with correct title', () => {
      renderWithClient(<Apps />)
      expect(documentTitleCalls).toContain('common.menus.apps')
    })

    it('should call useEducationInit', () => {
      renderWithClient(<Apps />)
      expect(educationInitCalls).toBeGreaterThan(0)
    })
  })

  describe('Integration', () => {
    it('should render full component tree', () => {
      renderWithClient(<Apps />)

      expect(screen.getByTestId('apps-list')).toBeInTheDocument()
      expect(documentTitleCalls.length).toBeGreaterThanOrEqual(1)
      expect(educationInitCalls).toBeGreaterThanOrEqual(1)
    })

    it('should handle multiple renders', () => {
      const queryClient = createQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <Apps />
        </QueryClientProvider>,
      )
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()

      rerender(
        <QueryClientProvider client={queryClient}>
          <Apps />
        </QueryClientProvider>,
      )
      expect(screen.getByTestId('apps-list')).toBeInTheDocument()
    })

    it('should track template preview creation after a successful import', async () => {
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: () => void }) => {
        options.onSuccess?.()
      })

      renderWithClient(<Apps />)

      fireEvent.click(screen.getByTestId('open-preview'))
      fireEvent.click(await screen.findByTestId('try-app-create'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      await waitFor(() => {
        expect(mockFetchAppDetail).toHaveBeenCalledWith('template-1')
        expect(mockTrackCreateApp).toHaveBeenCalledWith({
          appMode: AppModeEnum.CHAT,
        })
      })
    })

    it('should track template preview creation after confirming a pending import', async () => {
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onPending?: () => void }) => {
        options.onPending?.()
      })
      mockHandleImportDSLConfirm.mockImplementation(async (options: { onSuccess?: () => void }) => {
        options.onSuccess?.()
      })

      renderWithClient(<Apps />)

      fireEvent.click(screen.getByTestId('open-preview'))
      fireEvent.click(await screen.findByTestId('try-app-create'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      fireEvent.click(await screen.findByTestId('confirm-dsl'))

      await waitFor(() => {
        expect(mockHandleImportDSLConfirm).toHaveBeenCalledTimes(1)
        expect(mockTrackCreateApp).toHaveBeenCalledWith({
          appMode: AppModeEnum.CHAT,
        })
      })
    })

    it('should close the dsl confirm modal when the pending import is canceled', async () => {
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onPending?: () => void }) => {
        options.onPending?.()
      })

      renderWithClient(<Apps />)

      fireEvent.click(screen.getByTestId('open-preview'))
      fireEvent.click(await screen.findByTestId('try-app-create'))
      fireEvent.click(await screen.findByTestId('confirm-create'))

      fireEvent.click(await screen.findByTestId('cancel-dsl'))

      await waitFor(() => {
        expect(screen.queryByTestId('dsl-confirm-modal')).not.toBeInTheDocument()
      })
      expect(mockTrackCreateApp).not.toHaveBeenCalled()
    })

    it('should hide the create modal without tracking when the modal closes', async () => {
      renderWithClient(<Apps />)

      fireEvent.click(screen.getByTestId('open-preview'))
      fireEvent.click(await screen.findByTestId('try-app-create'))

      fireEvent.click(await screen.findByTestId('hide-create'))

      await waitFor(() => {
        expect(screen.queryByTestId('create-app-modal')).not.toBeInTheDocument()
      })
      expect(mockTrackCreateApp).not.toHaveBeenCalled()
    })
  })

  describe('Marketplace Template', () => {
    it('should render the template modal when template-id is in search params', async () => {
      mockSearchParams = new URLSearchParams('template-id=tpl-42')
      renderWithClient(<Apps />)

      expect(await screen.findByTestId('marketplace-template-modal')).toBeInTheDocument()
      expect(screen.getByTestId('template-id')).toHaveTextContent('tpl-42')
    })

    it('should not render the template modal when no template-id is present', () => {
      renderWithClient(<Apps />)

      expect(screen.queryByTestId('marketplace-template-modal')).not.toBeInTheDocument()
    })

    it('should close the template modal and remove template-id from URL', async () => {
      mockSearchParams = new URLSearchParams('template-id=tpl-42')
      renderWithClient(<Apps />)

      fireEvent.click(await screen.findByTestId('close-template'))

      expect(mockReplace).toHaveBeenCalledTimes(1)
      const replaceArg = mockReplace.mock.calls[0]![0] as string
      expect(replaceArg).not.toContain('template-id')
    })

    it('should import DSL from marketplace template on confirm', async () => {
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: () => void }) => {
        options.onSuccess?.()
      })
      mockSearchParams = new URLSearchParams('template-id=tpl-42')
      renderWithClient(<Apps />)

      fireEvent.click(await screen.findByTestId('confirm-template'))

      await waitFor(() => {
        expect(mockHandleImportDSL).toHaveBeenCalledWith(
          { mode: 'yaml-content', yaml_content: 'yaml-dsl-content' },
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        )
        expect(mockReplace).toHaveBeenCalled()
      })
    })

    it('should show DSL confirm modal when marketplace import is pending', async () => {
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onPending?: () => void }) => {
        options.onPending?.()
      })
      mockSearchParams = new URLSearchParams('template-id=tpl-42')
      renderWithClient(<Apps />)

      fireEvent.click(await screen.findByTestId('confirm-template'))

      await waitFor(() => {
        expect(screen.getByTestId('dsl-confirm-modal')).toBeInTheDocument()
        expect(mockReplace).toHaveBeenCalled()
      })
    })
  })

  describe('Styling', () => {
    it('should have overflow-y-auto class', () => {
      const { container } = renderWithClient(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('overflow-y-auto')
    })

    it('should have background styling', () => {
      const { container } = renderWithClient(<Apps />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('bg-background-body')
    })
  })
})
