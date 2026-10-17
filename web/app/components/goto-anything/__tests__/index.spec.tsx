import type { ReactNode } from 'react'
import type { SlashCommand } from '../actions/commands/types'
import type { SearchQueryOptions, SearchResult } from '../actions/types'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { toast } from '@/app/notifications'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createActions } from '../actions'
import { goCommand } from '../actions/commands/go'
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
  useParams: () => ({}),
}))

const isMac = detectPlatform() === 'mac'

function triggerSearchShortcut(target: Document | HTMLElement = document) {
  fireEvent.keyDown(target, {
    key: 'k',
    ctrlKey: !isMac,
    metaKey: isMac,
  })
}

type RemoteResponse = {
  data: TestSearchResult[]
  pending?: boolean
  error: Error | null
}

const emptyRemoteResponse = (): RemoteResponse => ({
  data: [],

  error: null,
})

let remoteResponses: Record<'app' | 'knowledge' | 'plugin' | 'skill' | 'agent', RemoteResponse> = {
  app: emptyRemoteResponse(),
  knowledge: emptyRemoteResponse(),
  plugin: emptyRemoteResponse(),
  skill: emptyRemoteResponse(),
  agent: emptyRemoteResponse(),
}
let requestedProviders: string[] = []
let remoteRequests: Array<[keyof typeof remoteResponses, string]> = []

const pendingRemoteRequests: Array<{
  provider: keyof typeof remoteResponses
  resolve: (value: TestSearchResult[]) => void
}> = []

async function searchRemote(provider: keyof typeof remoteResponses, searchTerm: string) {
  requestedProviders.push(provider)
  remoteRequests.push([provider, searchTerm])
  const response = remoteResponses[provider]
  if (response.error) throw response.error
  if (response.pending)
    return new Promise<TestSearchResult[]>((resolve) =>
      pendingRemoteRequests.push({ provider, resolve }),
    )
  return [...response.data]
}

function setRemoteResults(results: TestSearchResult[]) {
  results.forEach((result) => {
    if (
      result.type === 'app' ||
      result.type === 'knowledge' ||
      result.type === 'plugin' ||
      result.type === 'skill' ||
      result.type === 'agent'
    )
      remoteResponses[result.type].data.push(result)
  })
}

vi.mock('../actions/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../actions/app')>()),
  appSearchQueryOptions: (searchTerm: string, _scoped: boolean, options: SearchQueryOptions) => ({
    queryKey: ['app', searchTerm],
    queryFn: () => searchRemote('app', searchTerm),
    ...options,
  }),
}))

vi.mock('../actions/knowledge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../actions/knowledge')>()),
  knowledgeSearchQueryOptions: (searchTerm: string, options: SearchQueryOptions) => ({
    queryKey: ['knowledge', searchTerm],
    queryFn: () => searchRemote('knowledge', searchTerm),
    ...options,
  }),
}))

vi.mock('../actions/plugin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../actions/plugin')>()),
  pluginSearchQueryOptions: (searchTerm: string, _locale: string, options: SearchQueryOptions) => ({
    queryKey: ['plugin', searchTerm],
    queryFn: () => searchRemote('plugin', searchTerm),
    ...options,
  }),
}))

vi.mock('../actions/skill', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../actions/skill')>()),
  skillSearchQueryOptions: (searchTerm: string, options: SearchQueryOptions) => ({
    queryKey: ['skill', searchTerm],
    queryFn: () => searchRemote('skill', searchTerm),
    ...options,
  }),
}))

vi.mock('../actions/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../actions/agent')>()),
  agentSearchQueryOptions: (searchTerm: string, options: SearchQueryOptions) => ({
    queryKey: ['agent', searchTerm],
    queryFn: () => searchRemote('agent', searchTerm),
    ...options,
  }),
}))

const visibilityState = vi.hoisted(() => ({
  agentEnabled: true,
  datasetOperator: false,
  enableSkill: true,
}))

vi.mock('@/features/agent-v2/feature-flag', () => ({
  isAgentV2Enabled: () => visibilityState.agentEnabled,
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

vi.mock('../actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions')>()
  return { ...actual, createActions: vi.fn(actual.createActions) }
})

type MockSlashCommand = {
  mode: SlashCommand['mode']
  execute?: () => void
  isAvailable?: () => boolean
} | null

let mockFindCommand: MockSlashCommand = null
let mockAvailableCommands: SlashCommand[] = []
vi.mock('../actions/commands/catalog', async () => {
  const { SlashCommandRegistry } = await import('../actions/commands/registry')
  const registry = new SlashCommandRegistry([])
  registry.getAvailableCommands = (context) =>
    mockAvailableCommands.filter((command) => command.isAvailable?.(context) ?? true)
  registry.findCommand = (name) =>
    mockFindCommand
      ? { name, description: '', search: () => [], execute: vi.fn(), ...mockFindCommand }
      : mockAvailableCommands.find(
          (command) => command.name === name || command.aliases?.includes(name),
        )
  return { slashCommandRegistry: registry }
})

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

const renderGotoAnything = (ui: React.ReactElement) => {
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { role: visibilityState.datasetOperator ? 'dataset_operator' : 'owner' },
    features: { enable_skill: visibilityState.enableSkill },
  })
  const view = render(ui, { wrapper })
  return {
    ...view,
    rerender: (nextUi: React.ReactElement) => {
      act(() =>
        seedCurrentWorkspaceQuery(queryClient, {
          role: visibilityState.datasetOperator ? 'dataset_operator' : 'owner',
        }),
      )
      view.rerender(nextUi)
    },
  }
}

describe('GotoAnything', () => {
  beforeEach(() => {
    routerPush.mockClear()
    gotoAnythingDialogHandle.close()
    remoteResponses = {
      app: emptyRemoteResponse(),
      knowledge: emptyRemoteResponse(),
      plugin: emptyRemoteResponse(),
      skill: emptyRemoteResponse(),
      agent: emptyRemoteResponse(),
    }
    requestedProviders = []
    remoteRequests = []
    pendingRemoteRequests.length = 0
    vi.mocked(createActions).mockReset()
    visibilityState.agentEnabled = true
    visibilityState.datasetOperator = false
    visibilityState.enableSkill = true
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

    it('should leave a consumed shortcut to its local owner', () => {
      renderGotoAnything(
        <>
          <button type="button" onKeyDown={(event) => event.preventDefault()}>
            Local command
          </button>
          <GotoAnything />
        </>,
      )

      triggerSearchShortcut(screen.getByRole('button', { name: 'Local command' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it.each(['shiftKey', 'altKey'] as const)('should ignore Mod+K with %s', (extraModifier) => {
      renderGotoAnything(<GotoAnything />)

      fireEvent.keyDown(document, {
        key: 'k',
        ctrlKey: !isMac,
        metaKey: isMac,
        [extraModifier]: true,
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should ignore K with the non-primary platform modifier', () => {
      renderGotoAnything(<GotoAnything />)

      fireEvent.keyDown(document, {
        key: 'k',
        ctrlKey: isMac,
        metaKey: !isMac,
      })

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

    it('should keep the modal open when pressing Ctrl+K again', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)

      triggerSearchShortcut()
      const input = await screen.findByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'workflow')

      triggerSearchShortcut()

      expect(input).toHaveValue('workflow')
      expect(input).toHaveFocus()
    })

    it('should reopen with an empty search after the modal finishes closing', async () => {
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

  describe('command discovery', () => {
    it('tabs through visible shortcut controls and returns to typing after choosing a prefix', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox')
      const commands = screen.getByRole('button', { name: 'app.gotoAnything.groups.commands' })
      const scopes = screen.getByRole('button', { name: 'app.gotoAnything.selectSearchType' })

      await user.tab()
      expect(commands).toHaveFocus()
      await user.tab()
      expect(scopes).toHaveFocus()
      await user.tab()
      expect(input).toHaveFocus()

      await user.click(commands)
      expect(input).toHaveValue('/')
      expect(input).toHaveFocus()
      expect(
        screen.queryByRole('button', { name: 'app.gotoAnything.selectSearchType' }),
      ).not.toBeInTheDocument()
      await user.clear(input)
      await user.click(screen.getByRole('button', { name: 'app.gotoAnything.selectSearchType' }))
      expect(input).toHaveValue('@')
      expect(input).toHaveFocus()
      await user.clear(input)
      expect(
        screen.getByRole('gridcell', { name: /app.gotoAnything.allCommands/ }),
      ).toBeInTheDocument()
    })

    it('keeps other actions usable when a command search fails', async () => {
      const user = userEvent.setup()
      const execute = vi.fn()
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockAvailableCommands = [
        {
          name: 'theme',
          description: 'Theme',
          execute: vi.fn(),
          search: () => {
            throw new Error('Unavailable')
          },
        },
        { name: 'models', description: 'Models', mode: 'direct', search: () => [], execute },
      ]
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox')
      await waitFor(() => expect(input).toHaveFocus())
      await user.paste('models')
      expect(input).toHaveValue('models')
      expect(screen.getByRole('option', { name: /\/models/ })).toBeInTheDocument()
      await user.keyboard('{Enter}')
      expect(execute).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      warning.mockRestore()
    })

    it('shows available actions before search scopes without requiring a prefix', async () => {
      mockAvailableCommands = [
        {
          name: 'models',
          description: 'Models',
          mode: 'direct',
          execute: vi.fn(),
          search: () => [],
        },
        {
          name: 'refine',
          description: 'Refine',
          isAvailable: () => false,
          execute: vi.fn(),
          search: () => [],
        },
      ]
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox')
      const options = screen.getAllByRole('gridcell')
      expect(options[0]).toHaveTextContent('/models')
      expect(screen.queryByRole('gridcell', { name: /\/refine/ })).not.toBeInTheDocument()
      expect(screen.getByRole('gridcell', { name: /@app/ })).toBeInTheDocument()
      expect(input).toHaveAccessibleDescription('app.gotoAnything.searchHint')
      expect(requestedProviders).toEqual([])
    })

    it('opens a command submenu and returns home by clearing the input', async () => {
      const user = userEvent.setup()
      mockAvailableCommands = [
        { name: 'theme', description: 'Theme', execute: vi.fn(), search: () => [] },
      ]
      mockAvailableCommands[0]!.search = () => [
        { id: 'dark', type: 'command', title: 'Dark', data: { command: 'theme' } },
      ]
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox')
      await user.click(screen.getByRole('gridcell', { name: /app.gotoAnything.allCommands/ }))
      expect(input).toHaveValue('/')
      expect(input).toHaveFocus()
      await user.click(screen.getByRole('gridcell', { name: /\/theme/ }))
      expect(input).toHaveValue('/theme ')
      expect(screen.getByRole('option', { name: /Dark/ })).toBeInTheDocument()
      await user.clear(input)
      expect(input).toHaveValue('')
      expect(input).toHaveFocus()
      expect(screen.getByRole('gridcell', { name: /@app/ })).toBeInTheDocument()
    })

    it('finds an action by name and executes it once while resource providers fail', async () => {
      const user = userEvent.setup()
      const execute = vi.fn()
      mockAvailableCommands = [
        { name: 'models', description: 'Models', mode: 'direct', execute, search: () => [] },
      ]
      Object.values(remoteResponses).forEach((query) => {
        query.error = new Error('Offline')
      })
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox')
      await user.type(input, 'models')
      expect(screen.getByRole('option', { name: /\/models/ })).toBeInTheDocument()
      expect(screen.queryByText('app.gotoAnything.searchFailed')).not.toBeInTheDocument()
      await user.keyboard('{Enter}')
      expect(execute).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('finds a localized child action without its slash prefix', async () => {
      const user = userEvent.setup()
      const result: SearchResult = {
        id: 'dark',
        title: '深色主题',
        type: 'command',
        data: { command: 'theme', args: { value: 'dark' } },
      }
      mockAvailableCommands = [
        {
          name: 'theme',
          description: 'Theme',
          mode: 'submenu',
          execute: vi.fn(),
          search: () => [result],
        },
      ]
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox')
      await user.type(input, '深色')
      expect(screen.getByRole('option', { name: /深色主题/ })).toBeInTheDocument()
      await user.keyboard('{Enter}')
      expect(mockAvailableCommands[0]!.execute).toHaveBeenCalledExactlyOnceWith(
        { value: 'dark' },
        expect.any(Object),
      )
    })

    it('keeps the selected command stable when remote results arrive', async () => {
      const user = userEvent.setup()
      const execute = vi.fn()
      mockAvailableCommands = [
        { name: 'models', description: 'Models', mode: 'direct', search: () => [], execute },
      ]
      remoteResponses.app.pending = true
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox')
      await user.type(input, 'models')
      await waitFor(() => expect(remoteRequests).toContainEqual(['app', 'models']))
      await user.keyboard('{ArrowDown}')
      const selected = input.getAttribute('aria-activedescendant')
      remoteResponses.app.pending = false
      setRemoteResults([{ id: 'app', title: 'Models app', type: 'app', path: '/apps/model' }])
      await act(async () => {
        for (const request of pendingRemoteRequests)
          request.resolve([...remoteResponses[request.provider].data])
      })
      expect(await screen.findByRole('option', { name: /Models app/ })).toBeInTheDocument()
      expect(input).toHaveAttribute('aria-activedescendant', selected)
      expect(input).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(execute).toHaveBeenCalledTimes(1)
      expect(routerPush).not.toHaveBeenCalled()
    })
  })

  it('shows feedback when an activated command rejects and allows reopening', async () => {
    const user = userEvent.setup()
    const failure = new Error('Execution failed')
    const toastError = vi.spyOn(toast, 'error').mockReturnValue('command-error')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAvailableCommands = [
      {
        name: 'models',
        description: 'Models',
        mode: 'direct',
        search: () => [],
        execute: () => Promise.reject(failure),
      },
    ]
    renderGotoAnything(<GotoAnything />)
    triggerSearchShortcut()
    await user.click(await screen.findByRole('gridcell', { name: /\/models/ }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith('common.api.actionFailed'),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    triggerSearchShortcut()
    expect(await screen.findByRole('combobox')).toHaveValue('')
    toastError.mockRestore()
    consoleError.mockRestore()
  })

  it('updates an open command submenu when workspace access changes', async () => {
    const user = userEvent.setup()
    mockAvailableCommands = [goCommand]
    const { rerender } = renderGotoAnything(<GotoAnything />)
    triggerSearchShortcut()
    const input = await screen.findByRole('combobox')
    await user.type(input, '/go ')
    expect(screen.getByRole('option', { name: 'Agents /agents' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Skills /skills' })).toBeInTheDocument()
    visibilityState.agentEnabled = false
    visibilityState.datasetOperator = true
    rerender(<GotoAnything />)
    expect(screen.queryByRole('option', { name: 'Agents /agents' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: 'Skills /skills' })).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('option', { name: 'Apps /apps' }))
    expect(routerPush).toHaveBeenCalledExactlyOnceWith('/apps')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  describe('search functionality', () => {
    it.each([
      [{ agentEnabled: true, datasetOperator: false, enableSkill: true }, true, true],
      [{ agentEnabled: false, datasetOperator: false, enableSkill: true }, false, true],
      [{ agentEnabled: true, datasetOperator: true, enableSkill: true }, true, false],
      [{ agentEnabled: true, datasetOperator: false, enableSkill: false }, true, false],
    ] as const)(
      'matches scope visibility to workspace capabilities',
      async (visibility, agents, skills) => {
        Object.assign(visibilityState, visibility)

        renderGotoAnything(<GotoAnything />)

        triggerSearchShortcut()
        await screen.findByRole('combobox')
        expect(screen.queryByRole('gridcell', { name: /@agents/ }) !== null).toBe(agents)
        expect(screen.queryByRole('gridcell', { name: /@skill/ }) !== null).toBe(skills)
      },
    )

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
      expect(routerPush).toHaveBeenCalledTimes(1)
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
      await screen.findByRole('option', { name: /Keyboard App/ })
      await user.keyboard('{ArrowDown}{Enter}')

      expect(routerPush).toHaveBeenCalledWith('/apps/keyboard')
      expect(routerPush).toHaveBeenCalledTimes(1)
    })

    it('should navigate and loop within a command grid row with ArrowRight', async () => {
      const user = userEvent.setup()
      mockAvailableCommands = [
        { execute: vi.fn(), search: () => [], name: 'theme', description: 'Change theme' },
        { execute: vi.fn(), search: () => [], name: 'language', description: 'Change language' },
      ]

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, '/')
      const options = screen.getAllByRole('gridcell')
      expect(options).toHaveLength(2)
      expect(screen.getByRole('status')).toHaveTextContent(
        'app.gotoAnything.resultCount:{"count":2}',
      )
      const [firstOption, secondOption] = options
      if (!firstOption || !secondOption) throw new Error('Expected two command options')

      await user.keyboard('{ArrowRight}')
      expect(input).toHaveAttribute('aria-activedescendant', secondOption.id)

      await user.keyboard('{ArrowRight}')
      expect(input).toHaveAttribute('aria-activedescendant', firstOption.id)
    })

    it('should show the localized description for the knowledge scope', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, '@')

      expect(
        screen.getByRole('gridcell', {
          name: /@kb app\.gotoAnything\.actions\.searchKnowledgeBasesDesc/,
        }),
      ).toBeInTheDocument()
    })

    it('shows the localized system model name for /models', async () => {
      const user = userEvent.setup()
      mockAvailableCommands = [
        { execute: vi.fn(), search: () => [], name: 'models', description: 'Fallback description' },
      ]
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, '/')

      expect(
        screen.getByText('modelProvider.modelProvider.systemModelSettings'),
      ).toBeInTheDocument()
      expect(screen.queryByText('Fallback description')).not.toBeInTheDocument()
    })

    it('keeps an exact submenu command in the grid until selection commits it', async () => {
      const user = userEvent.setup()
      mockAvailableCommands = [
        { execute: vi.fn(), search: () => [], name: 'theme', description: 'Change theme' },
      ]
      mockAvailableCommands[0]!.search = () => [
        {
          id: 'theme-dark',
          type: 'command',
          title: 'Dark Theme',
          description: 'Use dark appearance',
          data: { command: 'theme', args: { value: 'dark' } },
        },
      ]

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, '/theme')

      expect(input).toHaveValue('/theme')
      expect(screen.getByRole('gridcell', { name: /\/theme/ })).toBeInTheDocument()
      expect(screen.queryByText('Dark Theme')).not.toBeInTheDocument()

      await user.keyboard('{Enter}')

      expect(input).toHaveValue('/theme ')
      expect(await screen.findByRole('option', { name: /Dark Theme/ })).toBeInTheDocument()
    })

    it('keeps a submenu root result visible while the committed delimiter catches up', async () => {
      const user = userEvent.setup()
      mockAvailableCommands = [
        { execute: vi.fn(), search: () => [], name: 'theme', description: 'Change theme' },
      ]
      mockAvailableCommands[0]!.search = (query: string) =>
        query === ''
          ? [
              {
                id: 'theme-dark',
                type: 'command',
                title: 'Dark Theme',
                data: { command: 'theme', args: { value: 'dark' } },
              },
            ]
          : []

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })
      await user.type(input, '/theme')
      await screen.findByRole('gridcell', { name: /\/theme/ })

      await user.keyboard('{Enter}')
      await user.type(input, 'unknown')

      expect(input).toHaveValue('/theme unknown')
      expect(await screen.findByRole('option', { name: /Dark Theme/ })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')
      expect(screen.queryByText('app.gotoAnything.noResults')).not.toBeInTheDocument()
    })

    it('does not leak a pending remote search into command or local-result contexts', async () => {
      const user = userEvent.setup()
      mockAvailableCommands = [
        { execute: vi.fn(), search: () => [], name: 'theme', description: 'Change theme' },
      ]
      mockAvailableCommands[0]!.search = () => [
        {
          id: 'theme-dark',
          type: 'command',
          title: 'Dark Theme',
          data: { command: 'theme', args: { value: 'dark' } },
        },
      ]
      setRemoteResults([
        {
          id: 'app-1',
          type: 'app',
          title: 'Stale Remote App',
          path: '/apps/stale',
          data: {},
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })
      await user.type(input, 'search')
      expect(await screen.findByText('Stale Remote App')).toBeInTheDocument()

      remoteResponses.app = {
        ...emptyRemoteResponse(),
        pending: true,
      }
      await user.type(input, ' next')
      await waitFor(() => expect(remoteRequests).toContainEqual(['app', 'search next']))
      await user.clear(input)
      await user.type(input, '/')
      await act(async () => {
        for (const request of pendingRemoteRequests)
          request.resolve([
            { id: 'late', type: 'app', title: 'Late Remote App', path: '/apps/late' },
          ])
      })
      expect(screen.queryByText('Late Remote App')).not.toBeInTheDocument()
      expect(screen.getByRole('gridcell', { name: /\/theme/ })).toBeInTheDocument()
      expect(screen.queryByText('Stale Remote App')).not.toBeInTheDocument()

      await user.keyboard('{Enter}')

      expect(input).toHaveValue('/theme ')
      expect(await screen.findByRole('option', { name: /Dark Theme/ })).toBeInTheDocument()
      expect(screen.queryByText('Stale Remote App')).not.toBeInTheDocument()
    })

    it('keeps submenu results visible while its argument is being debounced', async () => {
      const user = userEvent.setup()
      const darkThemeResult: SearchResult = {
        id: 'theme-dark',
        type: 'command',
        title: 'Dark Theme',
        description: 'Use dark appearance',
        data: { command: 'theme', args: { value: 'dark' } },
      }
      mockAvailableCommands = [
        {
          name: 'theme',
          description: 'Change theme',
          execute: vi.fn(),
          search: (query) => (query === '' ? [darkThemeResult] : []),
        },
      ]

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })
      await user.type(input, '/theme ')
      expect(await screen.findByRole('option', { name: /Dark Theme/ })).toBeInTheDocument()

      await user.type(input, 'unknown')

      expect(await screen.findByRole('option', { name: /Dark Theme/ })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')
      expect(screen.queryByText('app.gotoAnything.noResults')).not.toBeInTheDocument()

      await user.type(input, 'x')

      expect(await screen.findByText('app.gotoAnything.noResults')).toBeInTheDocument()
      expect(screen.queryByText('Dark Theme')).not.toBeInTheDocument()
    })

    it('queries skills and agents during ordinary search', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, 'research')

      await waitFor(() =>
        expect(requestedProviders).toEqual(
          expect.arrayContaining(['app', 'knowledge', 'plugin', 'skill', 'agent']),
        ),
      )
    })

    it('does not query skills when the skill feature is disabled', async () => {
      const user = userEvent.setup()
      visibilityState.enableSkill = false

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, 'research')

      await waitFor(() =>
        expect(requestedProviders).toEqual(
          expect.arrayContaining(['app', 'knowledge', 'plugin', 'agent']),
        ),
      )
      expect(requestedProviders).not.toContain('skill')
    })

    it('trims trailing whitespace before an ordinary remote search', async () => {
      const user = userEvent.setup()
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, 'research ')

      await waitFor(() =>
        expect(remoteRequests).toEqual(
          expect.arrayContaining([
            ['app', 'research'],
            ['knowledge', 'research'],
            ['plugin', 'research'],
          ]),
        ),
      )
      expect(remoteRequests).not.toEqual(
        expect.arrayContaining([
          ['app', 'research '],
          ['knowledge', 'research '],
          ['plugin', 'research '],
        ]),
      )
    })

    it('keeps general local results aligned with the debounced remote result set', async () => {
      const user = userEvent.setup()
      const nodeResult = {
        id: 'node-1',
        type: 'workflow-node',
        title: 'Stable Node',
        data: {},
      } as SearchResult
      const nodeSearch = vi.fn((query: string) => (query === 'node' ? [nodeResult] : []))
      const actual = await vi.importActual<typeof import('../actions')>('../actions')
      vi.mocked(createActions).mockImplementation((...args) => ({
        ...actual.createActions(...args),
        node: {
          key: '@node',
          shortcut: '@node',
          title: '@node title',
          description: '@node desc',
          source: 'local',
          search: nodeSearch,
        },
      }))

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })
      await user.type(input, 'node')
      expect(await screen.findByText('Stable Node')).toBeInTheDocument()

      await waitFor(() => expect(remoteRequests).toContainEqual(['app', 'node']))
      await user.type(input, 'xyz')

      expect(screen.getByText('Stable Node')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')

      await user.type(input, '2')

      expect(await screen.findByText('app.gotoAnything.noResults')).toBeInTheDocument()
      expect(screen.queryByText('Stable Node')).not.toBeInTheDocument()
    })

    it.each([
      ['@skill', 'skill'],
      ['@agents', 'agent'],
    ] as const)('limits %s searches to the matching provider', async (scope, provider) => {
      const user = userEvent.setup()

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, `${scope} research`)

      await waitFor(() => expect(requestedProviders).toContain(provider))
      expect(new Set(requestedProviders)).toEqual(new Set([provider]))
      expect(remoteRequests).toContainEqual([provider, 'research'])
    })

    it.each([
      ['skill', '/skills/skill-1'],
      ['agent', '/agents/agent-1/configure'],
    ] as const)('navigates to a selected %s result', async (type, path) => {
      const user = userEvent.setup()
      setRemoteResults([
        {
          id: `${type}-1`,
          type,
          title: `${type} result`,
          path,
          data: {},
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, type)
      await user.click(await screen.findByText(`${type} result`))

      expect(routerPush).toHaveBeenCalledWith(path)
    })

    it('should not search providers with a stale scope prefix', async () => {
      const user = userEvent.setup()

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })

      await user.type(input, '@')
      await screen.findByText('@app')
      requestedProviders = []
      await user.click(screen.getByText('@app'))

      expect(input).toHaveValue('@app ')
      expect(requestedProviders).toEqual([])
    })
  })

  describe('empty states', () => {
    it('should show loading state', async () => {
      const user = userEvent.setup()
      remoteResponses.app.pending = true

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder'),
        ).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')
      await user.type(input, 'search')

      expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')
      const list = screen.getByRole('listbox')
      expect(input).toHaveAttribute('aria-controls', list.id)
      expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    })

    it('should show error state', async () => {
      const user = userEvent.setup()
      const testError = new Error('Search failed')
      remoteResponses = {
        app: { data: [], error: testError },
        knowledge: { data: [], error: testError },
        plugin: { data: [], error: testError },
        skill: { data: [], error: testError },
        agent: { data: [], error: testError },
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

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searchFailed'),
      )
      expect(screen.queryByText('app.gotoAnything.someServicesUnavailable')).not.toBeInTheDocument()
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
      remoteResponses.plugin = {
        data: [],

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
      expect(screen.queryByText('app.gotoAnything.searchFailed')).not.toBeInTheDocument()
    })

    it('connects the scope grid to the accessible search input', async () => {
      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()

      await screen.findByRole('gridcell', { name: /@app/ })
      const input = screen.getByRole('combobox', { name: 'app.gotoAnything.searchTitle' })
      expect(input).toHaveAttribute('aria-haspopup', 'grid')
      expect(screen.getByRole('grid', { name: 'app.gotoAnything.searchTitle' })).toHaveAttribute(
        'id',
        input.getAttribute('aria-controls'),
      )
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

    it('keeps previous results visible while the next query is pending', async () => {
      const user = userEvent.setup()
      setRemoteResults([
        {
          id: 'app-1',
          type: 'app',
          title: 'Stable App',
          path: '/apps/stable',
          data: {},
        },
      ])

      renderGotoAnything(<GotoAnything />)
      triggerSearchShortcut()
      const input = await screen.findByRole('combobox', {
        name: 'app.gotoAnything.searchTitle',
      })
      await user.type(input, 'app')
      expect(await screen.findByText('Stable App')).toBeInTheDocument()

      remoteResponses.app = {
        ...emptyRemoteResponse(),
        pending: true,
      }
      await user.type(input, 'x')

      expect(screen.getByText('Stable App')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('app.gotoAnything.searching')
      expect(screen.queryByText('app.gotoAnything.noResults')).not.toBeInTheDocument()

      remoteResponses = {
        app: emptyRemoteResponse(),
        knowledge: emptyRemoteResponse(),
        plugin: emptyRemoteResponse(),
        skill: emptyRemoteResponse(),
        agent: emptyRemoteResponse(),
      }
      await user.type(input, '2')

      expect(await screen.findByText('app.gotoAnything.noResults')).toBeInTheDocument()
      expect(screen.queryByText('Stable App')).not.toBeInTheDocument()
    })
  })

  describe('plugin installation', () => {
    it.each(['close', 'success'])('closes the plugin installer after %s', async (outcome) => {
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
      await user.click(screen.getByRole('button', { name: outcome }))

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
      mockAvailableCommands = [
        { execute: vi.fn(), search: () => [], name: 'theme', description: 'Change theme' },
      ]

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

      expect(executeMock).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
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
      mockAvailableCommands = [
        { execute: vi.fn(), search: () => [], name: 'language', description: 'Change language' },
      ]

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
      expect(input).toHaveValue('/language ')
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
