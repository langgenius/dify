import type { ReactNode } from 'react'
import type { ActionItem, SearchResult } from '../actions/types'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { gotoAnythingDialogHandle } from '../dialog-handle'
import { GotoAnything } from '../index'

type TestSearchResult = Omit<SearchResult, 'icon' | 'data'> & {
  icon?: ReactNode
  data?: Record<string, unknown>
}

const routerPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
  }),
  usePathname: () => '/',
}))

vi.mock('ahooks', () => ({
  useDebounce: <T,>(value: T) => value,
}))

function triggerSearchShortcut(target: Window | HTMLElement = window) {
  fireEvent.keyDown(target, { key: 'k', ctrlKey: true })
}

type RemoteQueryState = {
  data: TestSearchResult[]
  isLoading: boolean
  isError: boolean
  error: Error | null
}

const emptyRemoteQueryState = (): RemoteQueryState => ({
  data: [],
  isLoading: false,
  isError: false,
  error: null,
})

let remoteQueryStates: Record<'app' | 'knowledge' | 'plugin', RemoteQueryState> = {
  app: emptyRemoteQueryState(),
  knowledge: emptyRemoteQueryState(),
  plugin: emptyRemoteQueryState(),
}

function setRemoteResults(results: TestSearchResult[]) {
  results.forEach((result) => {
    if (result.type === 'app' || result.type === 'knowledge' || result.type === 'plugin')
      remoteQueryStates[result.type].data.push(result)
  })
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: [key: keyof typeof remoteQueryStates]; enabled?: boolean }) =>
    options.enabled ? remoteQueryStates[options.queryKey[0]] : emptyRemoteQueryState(),
}))

vi.mock('../actions/app', () => ({
  appSearchQueryOptions: () => ({ queryKey: ['app'] }),
}))

vi.mock('../actions/knowledge', () => ({
  knowledgeSearchQueryOptions: () => ({ queryKey: ['knowledge'] }),
}))

vi.mock('../actions/plugin', () => ({
  pluginSearchQueryOptions: () => ({ queryKey: ['plugin'] }),
}))
vi.mock(
  '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission',
  () => ({
    default: () => ({
      canInstallPlugin: true,
      currentDifyVersion: '1.0.0',
    }),
  }),
)

const createRemoteAction = (key: ActionItem['key'], shortcut: string): ActionItem => ({
  key,
  shortcut,
  title: `${key} title`,
  description: `${key} desc`,
  source: 'remote',
})

const actionsMock = {
  slash: {
    key: '/',
    shortcut: '/',
    title: '/ title',
    description: '/ desc',
    source: 'local',
    action: vi.fn(),
    search: vi.fn(() => []),
  } satisfies ActionItem,
  app: createRemoteAction('@app', '@app'),
  knowledge: createRemoteAction('@knowledge', '@kb'),
  plugin: createRemoteAction('@plugin', '@plugin'),
}

const createActionsMock = vi.fn(() => actionsMock)
const matchActionMock = vi.fn(() => undefined)
vi.mock('../actions', () => ({
  createActions: () => createActionsMock(),
  getActionSearchTerm: (_query: string, action: ActionItem) => action.key,
  matchAction: () => matchActionMock(),
}))

vi.mock('../actions/commands/slash-provider', () => ({
  SlashCommandProvider: () => null,
}))

type MockSlashCommand = {
  mode: string
  execute?: () => void
  isAvailable?: () => boolean
} | null

let mockFindCommand: MockSlashCommand = null
let mockAvailableCommands: Array<{ name: string; description: string }> = []
vi.mock('../actions/commands/registry', () => ({
  slashCommandRegistry: {
    findCommand: () => mockFindCommand,
    getAvailableCommands: () => mockAvailableCommands,
    getAllCommands: () => [],
  },
}))

vi.mock('@/app/components/workflow/utils/node-navigation', () => ({
  selectWorkflowNode: vi.fn(),
}))

vi.mock('../../plugins/install-plugin/install-from-marketplace', () => ({
  default: (props: {
    manifest?: { name?: string }
    onClose: () => void
    onSuccess: () => void
  }) => (
    <div data-testid="install-modal">
      <span>{props.manifest?.name}</span>
      <button onClick={props.onClose} data-testid="close-install">
        close
      </button>
      <button onClick={props.onSuccess} data-testid="success-install">
        success
      </button>
    </div>
  ),
}))

const renderGotoAnything = (ui: React.ReactElement) => render(ui)

describe('GotoAnything', () => {
  beforeEach(() => {
    routerPush.mockClear()
    gotoAnythingDialogHandle.close()
    remoteQueryStates = {
      app: emptyRemoteQueryState(),
      knowledge: emptyRemoteQueryState(),
      plugin: emptyRemoteQueryState(),
    }
    matchActionMock.mockReset()
    mockFindCommand = null
    mockAvailableCommands = []
  })

  describe('modal behavior', () => {
    it('should open modal via Ctrl+K shortcut', async () => {
      renderGotoAnything(<GotoAnything />)

      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByRole('dialog', { name: 'app.gotoAnything.searchTitle' }),
        ).toBeInTheDocument()
        expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toHaveFocus()
      })
    })

    it('should not open from an unrelated editable field', () => {
      renderGotoAnything(
        <>
          <input aria-label="Unrelated field" />
          <GotoAnything />
        </>,
      )

      triggerSearchShortcut(screen.getByRole('textbox', { name: 'Unrelated field' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should restore focus to the detached trigger after Escape', async () => {
      const user = userEvent.setup()
      renderGotoAnything(
        <>
          <DialogTrigger
            handle={gotoAnythingDialogHandle}
            render={<button type="button">Search</button>}
          />
          <GotoAnything />
        </>,
      )
      const trigger = screen.getByRole('button', { name: 'Search' })

      await user.click(trigger)
      expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toHaveFocus()

      await user.keyboard('{Escape}')

      await waitFor(() => expect(trigger).toHaveFocus())
    })

    it('should close modal via ESC key', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)

      triggerSearchShortcut()
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).not.toBeInTheDocument()
      })
    })

    it('should toggle modal when pressing Ctrl+K twice', async () => {
      renderGotoAnything(<GotoAnything />)

      triggerSearchShortcut()
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      triggerSearchShortcut()
      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).not.toBeInTheDocument()
      })
    })

    it('should reset search query when modal opens', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)

      triggerSearchShortcut()
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'test')

      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).not.toBeInTheDocument()
      })

      triggerSearchShortcut()
      await waitFor(() => {
        const newInput = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
        expect(newInput).toHaveValue('')
      })
    })
  })

  describe('search functionality', () => {
    it('should navigate to selected result', async () => {
      const user = userEvent.setup()
      setRemoteResults([
        {
          id: 'app-1',
          type: 'app',
          title: 'Sample App',
          description: 'desc',
          path: '/apps/1',
          icon: <div data-testid="icon">🧩</div>,
          data: {},
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'app')

      const result = await screen.findByText('Sample App')
      await user.click(result)

      expect(routerPush).toHaveBeenCalledWith('/apps/1')
    })

    it('should navigate the highlighted result with ArrowDown and Enter', async () => {
      const user = userEvent.setup()
      setRemoteResults([
        {
          id: 'app-1',
          type: 'app',
          title: 'Keyboard App',
          path: '/apps/keyboard',
          data: {},
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, 'keyboard')
      await user.keyboard('{ArrowDown}{Enter}')

      expect(routerPush).toHaveBeenCalledWith('/apps/keyboard')
    })

    it('should clear selection when typing without prefix', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'test query')

      expect(input).toHaveValue('test query')
    })
  })

  describe('empty states', () => {
    it('should show loading state', async () => {
      const user = userEvent.setup()
      remoteQueryStates.app.isLoading = true

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'search')

      const searchingTexts = screen.getAllByText('app.gotoAnything.searching')
      expect(searchingTexts.length).toBeGreaterThanOrEqual(1)
      expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')
      expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    })

    it('should show error state', async () => {
      const user = userEvent.setup()
      const testError = new Error('Search failed')
      remoteQueryStates = {
        app: { data: [], isLoading: false, isError: true, error: testError },
        knowledge: { data: [], isLoading: false, isError: true, error: testError },
        plugin: { data: [], isLoading: false, isError: true, error: testError },
      }

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'search')

      expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searchFailed')
      expect(screen.getAllByText('app.gotoAnything.searchFailed')).toHaveLength(2)
    })

    it('should preserve successful results when one provider fails', async () => {
      const user = userEvent.setup()
      setRemoteResults([
        {
          id: 'app-1',
          type: 'app',
          title: 'Available App',
          path: '/apps/available',
          data: {},
        },
      ])
      remoteQueryStates.plugin = {
        data: [],
        isLoading: false,
        isError: true,
        error: new Error('Marketplace unavailable'),
      }

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, 'available')

      expect(await screen.findByText('Available App')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(
        'app.gotoAnything.someServicesUnavailable',
      )
      expect(screen.getAllByText('app.gotoAnything.someServicesUnavailable')).toHaveLength(2)
      expect(screen.queryByText('app.gotoAnything.searchFailed')).not.toBeInTheDocument()
    })

    it('should show default state when no query', async () => {
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      expect(screen.getAllByText('app.gotoAnything.searchTitle')).toHaveLength(2)
    })

    it('should show no results state when search returns empty', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'nonexistent')

      expect(await screen.findByText('app.gotoAnything.noResults')).toBeInTheDocument()
    })
  })

  describe('plugin installation', () => {
    it('should open plugin installer when selecting plugin result', async () => {
      const user = userEvent.setup()
      setRemoteResults([
        {
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
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'plugin')

      const pluginItem = await screen.findByText('Plugin Item')
      await user.click(pluginItem)

      expect(await screen.findByTestId('install-modal')).toHaveTextContent('Plugin Item')
    })

    it('should close plugin installer via close button', async () => {
      const user = userEvent.setup()
      setRemoteResults([
        {
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
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
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
      setRemoteResults([
        {
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
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
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
      mockAvailableCommands = [{ name: 'theme', description: 'Change theme' }]

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
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

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
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
      mockAvailableCommands = [{ name: 'language', description: 'Change language' }]

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
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
      mockAvailableCommands = [{ name: 'theme', description: 'Change theme' }]

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, '/theme')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('result navigation', () => {
    it('should handle knowledge result navigation', async () => {
      const user = userEvent.setup()
      setRemoteResults([
        {
          id: 'kb-1',
          type: 'knowledge',
          title: 'Knowledge Base',
          description: 'desc',
          path: '/datasets/kb-1',
          icon: <div />,
          data: {},
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'knowledge')

      const result = await screen.findByText('Knowledge Base')
      await user.click(result)

      expect(routerPush).toHaveBeenCalledWith('/datasets/kb-1')
    })

    it('should NOT navigate when result has no path', async () => {
      const user = userEvent.setup()
      setRemoteResults([
        {
          id: 'item-1',
          type: 'app',
          title: 'No Path Item',
          description: 'desc',
          path: '',
          icon: <div />,
          data: {},
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'no path')

      const result = await screen.findByText('No Path Item')
      await user.click(result)

      expect(routerPush).not.toHaveBeenCalled()
    })
  })
})
