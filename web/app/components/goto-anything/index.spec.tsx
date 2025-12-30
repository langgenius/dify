import type { ActionItem, SearchResult } from './actions/types'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import GotoAnything from './index'

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
  }),
  usePathname: () => '/',
}))

const keyPressHandlers: Record<string, (event: any) => void> = {}
vi.mock('ahooks', () => ({
  useDebounce: (value: any) => value,
  useKeyPress: (keys: string | string[], handler: (event: any) => void) => {
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

let mockQueryResult = { data: [] as SearchResult[], isLoading: false, isError: false, error: null as Error | null }
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

vi.mock('./actions/commands/registry', () => ({
  slashCommandRegistry: {
    findCommand: () => null,
    getAvailableCommands: () => [],
    getAllCommands: () => [],
  },
}))

vi.mock('@/app/components/workflow/utils/common', () => ({
  getKeyboardKeyCodeBySystem: () => 'ctrl',
  isEventTargetInputArea: () => false,
  isMac: () => false,
}))

vi.mock('@/app/components/workflow/utils/node-navigation', () => ({
  selectWorkflowNode: vi.fn(),
}))

vi.mock('../plugins/install-plugin/install-from-marketplace', () => ({
  default: (props: { manifest?: { name?: string }, onClose: () => void }) => (
    <div data-testid="install-modal">
      <span>{props.manifest?.name}</span>
      <button onClick={props.onClose}>close</button>
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
  })

  it('should open modal via shortcut and navigate to selected result', async () => {
    mockQueryResult = {
      data: [{
        id: 'app-1',
        type: 'app',
        title: 'Sample App',
        description: 'desc',
        path: '/apps/1',
        icon: <div data-testid="icon">🧩</div>,
        data: {},
      } as any],
      isLoading: false,
      isError: false,
      error: null,
    }

    render(<GotoAnything />)

    triggerKeyPress('ctrl.k')

    const input = await screen.findByPlaceholderText('app.gotoAnything.searchPlaceholder')
    await userEvent.type(input, 'app')

    const result = await screen.findByText('Sample App')
    await userEvent.click(result)

    expect(routerPush).toHaveBeenCalledWith('/apps/1')
  })

  it('should open plugin installer when selecting plugin result', async () => {
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
      } as any],
      isLoading: false,
      isError: false,
      error: null,
    }

    render(<GotoAnything />)

    triggerKeyPress('ctrl.k')
    const input = await screen.findByPlaceholderText('app.gotoAnything.searchPlaceholder')
    await userEvent.type(input, 'plugin')

    const pluginItem = await screen.findByText('Plugin Item')
    await userEvent.click(pluginItem)

    expect(await screen.findByTestId('install-modal')).toHaveTextContent('Plugin Item')
  })
})
