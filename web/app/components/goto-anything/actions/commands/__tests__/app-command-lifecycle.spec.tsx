import { act } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { executeCommand } from '../command-bus'
import { slashCommandRegistry } from '../registry'
import { SlashCommandProvider } from '../slash-provider'

const { route, theme } = vi.hoisted(() => ({
  route: { appId: 'app-a' as string | undefined, pathname: '/app/app-a/logs' },
  theme: { setTheme: vi.fn() },
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ appId: route.appId }),
  usePathname: () => route.pathname,
}))
vi.mock('next-themes', () => ({ useTheme: () => theme }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_FEATURE_PREVIEW: true,
}))
vi.mock('@/i18n/client', () => ({ setLocaleOnClient: vi.fn() }))
vi.mock('@/features/agent-v2/feature-flag', () => ({ isAgentV2Enabled: () => true }))

const isRefineAvailable = () =>
  slashCommandRegistry.getAvailableCommands().some((command) => command.name === 'refine')

beforeEach(() => {
  route.appId = 'app-a'
  route.pathname = '/app/app-a/logs'
  theme.setTheme = vi.fn()
  useAppStore.setState({ appDetail: createAppDetailFixture({ id: 'app-a', mode: 'workflow' }) })
})

it('binds commands to the current route through stale snapshots, late selections, and unmount', async () => {
  const view = render(<SlashCommandProvider />)
  expect(isRefineAvailable()).toBe(true)
  await executeCommand('refine.open')
  expect(useWorkflowGeneratorStore.getState()).toMatchObject({
    isOpen: true,
    intent: 'refine',
    currentAppId: 'app-a',
    currentAppMode: 'workflow',
  })
  const selectedResult = slashCommandRegistry.search('/create workflow improve flow')[0]!
  useWorkflowGeneratorStore.getState().closeGenerator()

  route.appId = 'app-b'
  route.pathname = '/app/app-b/logs'
  view.rerender(<SlashCommandProvider />)
  expect(isRefineAvailable()).toBe(false)
  await executeCommand('refine.open')
  expect(useWorkflowGeneratorStore.getState().isOpen).toBe(false)
  await executeCommand(selectedResult.data.command, selectedResult.data.args)
  expect(useWorkflowGeneratorStore.getState()).toMatchObject({
    isOpen: true,
    intent: 'create',
    currentAppId: null,
    initialInstruction: 'improve flow',
  })

  act(() => {
    useAppStore.setState({ appDetail: createAppDetailFixture({ id: 'app-b', mode: 'workflow' }) })
  })
  expect(isRefineAvailable()).toBe(true)
  await executeCommand('refine.open')
  expect(useWorkflowGeneratorStore.getState()).toMatchObject({
    intent: 'refine',
    currentAppId: 'app-b',
    currentAppMode: 'workflow',
  })
  await executeCommand(selectedResult.data.command, selectedResult.data.args)
  expect(useWorkflowGeneratorStore.getState()).toMatchObject({
    intent: 'create',
    currentAppId: 'app-b',
    initialInstruction: 'improve flow',
  })

  route.appId = undefined
  route.pathname = '/apps'
  view.rerender(<SlashCommandProvider />)
  useWorkflowGeneratorStore.getState().closeGenerator()
  expect(isRefineAvailable()).toBe(false)
  await executeCommand('refine.open')
  expect(useWorkflowGeneratorStore.getState().isOpen).toBe(false)
  await executeCommand(selectedResult.data.command, selectedResult.data.args)
  expect(useWorkflowGeneratorStore.getState()).toMatchObject({
    isOpen: true,
    currentAppId: null,
  })

  view.unmount()
  useWorkflowGeneratorStore.getState().closeGenerator()
  expect(slashCommandRegistry.findCommand('create')).toBeUndefined()
  expect(slashCommandRegistry.findCommand('improve')).toBeUndefined()
  await executeCommand(selectedResult.data.command, selectedResult.data.args)
  await executeCommand('refine.open')
  expect(useWorkflowGeneratorStore.getState().isOpen).toBe(false)
})

it('retains graph app commands on logs when unrelated theme commands are registered again', async () => {
  useAppStore.setState({
    appDetail: createAppDetailFixture({ id: 'app-a', mode: 'advanced-chat' }),
  })
  const view = render(<SlashCommandProvider />)
  theme.setTheme = vi.fn()
  view.rerender(<SlashCommandProvider />)

  await executeCommand('theme.set', { value: 'dark' })
  expect(theme.setTheme).toHaveBeenCalledExactlyOnceWith('dark')
  expect(isRefineAvailable()).toBe(true)
  await executeCommand('refine.open')
  expect(useWorkflowGeneratorStore.getState()).toMatchObject({
    intent: 'refine',
    currentAppId: 'app-a',
    currentAppMode: 'advanced-chat',
  })
  await executeCommand('create.open', { mode: 'advanced-chat' })
  expect(useWorkflowGeneratorStore.getState()).toMatchObject({
    intent: 'create',
    currentAppId: 'app-a',
    currentAppMode: 'advanced-chat',
  })
})
