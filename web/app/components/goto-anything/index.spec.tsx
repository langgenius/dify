import type { ReactNode } from 'react'
import type { ActionItem, SearchResult } from './actions/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import GotoAnything from './index'

// Test helper type that matches SearchResult but allows ReactNode for icon and flexible data
type TestSearchResult = Omit<SearchResult, 'icon' | 'data'> & {
  icon?: ReactNode
  data?: Record<string, unknown>
}

// Mock react-i18next to return namespace.key format
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      const ns = options?.ns || 'common'
      return `${ns}.${key}`
    },
    i18n: { language: 'en' },
  }),
}))

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
  }),
  usePathname: () => '/',
}))

type KeyPressEvent = {
  preventDefault: () => void
  target?: EventTarget
}

const keyPressHandlers: Record<string, (event: KeyPressEvent) => void> = {}
vi.mock('ahooks', () => ({
  useDebounce: <T,>(value: T) => value,
  useKeyPress: (keys: string | string[], handler: (event: KeyPressEvent) => void) => {
    const keyList = Array.isArray(keys) ? keys : [keys]
    keyList.forEach((key) => {
      keyPressHandlers[key] = handler
    })
  },
}))

const triggerKeyPress = (combo: string) => {
  const handler = keyPressHandlers[combo]
  if (handler) {
    act(() => {
      handler({ preventDefault: vi.fn(), target: document.body })
    })
  }
}

let mockQueryResult = { data: [] as TestSearchResult[], isLoading: false, isError: false, error: null as Error | null }
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mockQueryResult,
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
}))

const contextValue = { isWorkflowPage: false, isRagPipelinePage: false }
vi.mock('./context', () => ({
  useGotoAnythingContext: () => contextValue,
  GotoAnythingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/app/components/workflow/utils', () => ({
  getKeyboardKeyNameBySystem: (key: string) => key,
}))

const createActionItem = (key: ActionItem['key'], shortcut: string): ActionItem => ({
  key,
  shortcut,
  title: `${key} title`,
  description: `${key} desc`,
  action: vi.fn(),
  search: vi.fn(),
})

const actionsMock = {
  slash: createActionItem('/', '/'),
  app: createActionItem('@app', '@app'),
  plugin: createActionItem('@plugin', '@plugin'),
}

const createActionsMock = vi.fn(() => actionsMock)
const matchActionMock = vi.fn(() => undefined)
const searchAnythingMock = vi.fn(async () => mockQueryResult.data)

vi.mock('./actions', () => ({
  createActions: () => createActionsMock(),
  matchAction: () => matchActionMock(),
  searchAnything: () => searchAnythingMock(),
}))

vi.mock('./actions/commands', () => ({
  SlashCommandProvider: () => null,
}))

type MockSlashCommand = {
  mode: string
  execute?: () => void
  isAvailable?: () => boolean
} | null

let mockFindCommand: MockSlashCommand = null
vi.mock('./actions/commands/registry', () => ({
  slashCommandRegistry: {
    findCommand: () => mockFindCommand,
    getAvailableCommands: () => [],
    getAllCommands: () => [],
  },
}))

vi.mock('@/app/components/workflow/utils/common', () => ({
  getKeyboardKeyCodeBySystem: () => 'ctrl',
  getKeyboardKeyNameBySystem: (key: string) => key,
  isEventTargetInputArea: () => false,
  isMac: () => false,
}))

vi.mock('@/app/components/workflow/utils/node-navigation', () => ({
  selectWorkflowNode: vi.fn(),
}))

vi.mock('../plugins/install-plugin/install-from-marketplace', () => ({
  default: (props: { manifest?: { name?: string }, onClose: () => void, onSuccess: () => void }) => (
    <div data-testid="install-modal">
      <span>{props.manifest?.name}</span>
      <button onClick={props.onClose} data-testid="close-install">close</button>
      <button onClick={props.onSuccess} data-testid="success-install">success</button>
    </div>
  ),
}))

describe('GotoAnything', () => {
  beforeEach(() => {
    routerPush.mockClear()
    Object.keys(keyPressHandlers).forEach(key => delete keyPressHandlers[key])
    mockQueryResult = { data: [], isLoading: false, isError: false, error: null }
    matchActionMock.mockReset()
    searchAnythingMock.mockClear()
    mockFindCommand = null
  })

  describe('modal behavior', () => {
    it('should open modal via Ctrl+K shortcut', async () => {
      render(<GotoAnything />)

      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })
    })

    it('should close modal via ESC key', async () => {
      render(<GotoAnything />)

      triggerKeyPress('ctrl.k')
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      triggerKeyPress('esc')
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.gotoAnything.searchPlaceholder')).not.toBeInTheDocument()
      })
    })

    it('should toggle modal when pressing Ctrl+K twice', async () => {
      render(<GotoAnything />)

      triggerKeyPress('ctrl.k')
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      triggerKeyPress('ctrl.k')
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.gotoAnything.searchPlaceholder')).not.toBeInTheDocument()
      })
    })

    it('should call onHide when modal closes', async () => {
      const onHide = vi.fn()
      render(<GotoAnything onHide={onHide} />)

      triggerKeyPress('ctrl.k')
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      triggerKeyPress('esc')
      await waitFor(() => {
        expect(onHide).toHaveBeenCalled()
      })
    })

    it('should reset search query when modal opens', async () => {
      const user = userEvent.setup()
      render(<GotoAnything />)

      // Open modal first time
      triggerKeyPress('ctrl.k')
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      // Type something
      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'test')

      // Close modal
      triggerKeyPress('esc')
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.gotoAnything.searchPlaceholder')).not.toBeInTheDocument()
      })

      // Open modal again - should be empty
      triggerKeyPress('ctrl.k')
      await waitFor(() => {
        const newInput = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
        expect(newInput).toHaveValue('')
      })
    })
  })

  describe('search functionality', () => {
    it('should navigate to selected result', async () => {
      const user = userEvent.setup()
      mockQueryResult = {
        data: [{
          id: 'app-1',
          type: 'app',
          title: 'Sample App',
          description: 'desc',
          path: '/apps/1',
          icon: <div data-testid="icon">🧩</div>,
          data: {},
        }],
        isLoading: false,
        isError: false,
        error: null,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'app')

      const result = await screen.findByText('Sample App')
      await user.click(result)

      expect(routerPush).toHaveBeenCalledWith('/apps/1')
    })

    it('should clear selection when typing without prefix', async () => {
      const user = userEvent.setup()
      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'test query')

      // Should not throw and input should have value
      expect(input).toHaveValue('test query')
    })
  })

  describe('empty states', () => {
    it('should show loading state', async () => {
      const user = userEvent.setup()
      mockQueryResult = {
        data: [],
        isLoading: true,
        isError: false,
        error: null,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'search')

      // Loading state shows in both EmptyState (spinner) and Footer
      const searchingTexts = screen.getAllByText('app.gotoAnything.searching')
      expect(searchingTexts.length).toBeGreaterThanOrEqual(1)
    })

    it('should show error state', async () => {
      const user = userEvent.setup()
      const testError = new Error('Search failed')
      mockQueryResult = {
        data: [],
        isLoading: false,
        isError: true,
        error: testError,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'search')

      expect(screen.getByText('app.gotoAnything.searchFailed')).toBeInTheDocument()
    })

    it('should show default state when no query', async () => {
      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      expect(screen.getByText('app.gotoAnything.searchTitle')).toBeInTheDocument()
    })

    it('should show no results state when search returns empty', async () => {
      const user = userEvent.setup()
      mockQueryResult = {
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'nonexistent')

      expect(screen.getByText('app.gotoAnything.noResults')).toBeInTheDocument()
    })
  })

  describe('plugin installation', () => {
    it('should open plugin installer when selecting plugin result', async () => {
      const user = userEvent.setup()
      mockQueryResult = {
        data: [{
          id: 'plugin-1',
          type: 'plugin',
          title: 'Plugin Item',
          description: 'desc',
          path: '',
          icon: <div />,
          data: {
            name: 'Plugin Item',
            latest_package_identifier: 'pkg',
          },
        }],
        isLoading: false,
        isError: false,
        error: null,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'plugin')

      const pluginItem = await screen.findByText('Plugin Item')
      await user.click(pluginItem)

      expect(await screen.findByTestId('install-modal')).toHaveTextContent('Plugin Item')
    })

    it('should close plugin installer via close button', async () => {
      const user = userEvent.setup()
      mockQueryResult = {
        data: [{
          id: 'plugin-1',
          type: 'plugin',
          title: 'Plugin Item',
          description: 'desc',
          path: '',
          icon: <div />,
          data: {
            name: 'Plugin Item',
            latest_package_identifier: 'pkg',
          },
        }],
        isLoading: false,
        isError: false,
        error: null,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'plugin')

      const pluginItem = await screen.findByText('Plugin Item')
      await user.click(pluginItem)

      const closeBtn = await screen.findByTestId('close-install')
      await user.click(closeBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
      })
    })

    it('should close plugin installer on success', async () => {
      const user = userEvent.setup()
      mockQueryResult = {
        data: [{
          id: 'plugin-1',
          type: 'plugin',
          title: 'Plugin Item',
          description: 'desc',
          path: '',
          icon: <div />,
          data: {
            name: 'Plugin Item',
            latest_package_identifier: 'pkg',
          },
        }],
        isLoading: false,
        isError: false,
        error: null,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'plugin')

      const pluginItem = await screen.findByText('Plugin Item')
      await user.click(pluginItem)

      const successBtn = await screen.findByTestId('success-install')
      await user.click(successBtn)

      await waitFor(() => {
        expect(screen.queryByTestId('install-modal')).not.toBeInTheDocument()
      })
    })
  })

  describe('slash command handling', () => {
    it('should execute direct slash command on Enter', async () => {
      const user = userEvent.setup()
      const executeMock = vi.fn()
      mockFindCommand = {
        mode: 'direct',
        execute: executeMock,
        isAvailable: () => true,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, '/theme')
      await user.keyboard('{Enter}')

      expect(executeMock).toHaveBeenCalled()
    })

    it('should NOT execute unavailable slash command', async () => {
      const user = userEvent.setup()
      const executeMock = vi.fn()
      mockFindCommand = {
        mode: 'direct',
        execute: executeMock,
        isAvailable: () => false,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, '/theme')
      await user.keyboard('{Enter}')

      expect(executeMock).not.toHaveBeenCalled()
    })

    it('should NOT execute non-direct mode slash command on Enter', async () => {
      const user = userEvent.setup()
      const executeMock = vi.fn()
      mockFindCommand = {
        mode: 'submenu',
        execute: executeMock,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, '/language')
      await user.keyboard('{Enter}')

      expect(executeMock).not.toHaveBeenCalled()
    })

    it('should close modal after executing direct slash command', async () => {
      const user = userEvent.setup()
      mockFindCommand = {
        mode: 'direct',
        execute: vi.fn(),
        isAvailable: () => true,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, '/theme')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.gotoAnything.searchPlaceholder')).not.toBeInTheDocument()
      })
    })
  })

  describe('result navigation', () => {
    it('should handle knowledge result navigation', async () => {
      const user = userEvent.setup()
      mockQueryResult = {
        data: [{
          id: 'kb-1',
          type: 'knowledge',
          title: 'Knowledge Base',
          description: 'desc',
          path: '/datasets/kb-1',
          icon: <div />,
          data: {},
        }],
        isLoading: false,
        isError: false,
        error: null,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'knowledge')

      const result = await screen.findByText('Knowledge Base')
      await user.click(result)

      expect(routerPush).toHaveBeenCalledWith('/datasets/kb-1')
    })

    it('should NOT navigate when result has no path', async () => {
      const user = userEvent.setup()
      mockQueryResult = {
        data: [{
          id: 'item-1',
          type: 'app',
          title: 'No Path Item',
          description: 'desc',
          path: '',
          icon: <div />,
          data: {},
        }],
        isLoading: false,
        isError: false,
        error: null,
      }

      render(<GotoAnything />)
      triggerKeyPress('ctrl.k')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'no path')

      const result = await screen.findByText('No Path Item')
      await user.click(result)

      expect(routerPush).not.toHaveBeenCalled()
    })
  })
})
