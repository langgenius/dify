import { useWorkflowGeneratorStore as store } from '../store'

beforeEach(() => {
  store.setState(store.getInitialState(), true)
  sessionStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
  store.setState(store.getInitialState(), true)
})

it('replaces Studio context when opening a new-app session', () => {
  store.getState().openGenerator({
    mode: 'workflow',
    intent: 'refine',
    currentAppId: 'app-1',
    currentAppMode: 'workflow',
    initialInstruction: 'Refine this graph',
    autoMode: true,
  })
  store.getState().closeGenerator()
  expect(store.getState()).toMatchObject({ isOpen: false, currentAppId: 'app-1', intent: 'refine' })
  store.getState().openGenerator({ mode: 'advanced-chat' })
  expect(store.getState()).toMatchObject({
    isOpen: true,
    mode: 'advanced-chat',
    currentAppId: null,
    currentAppMode: null,
    intent: 'create',
    initialInstruction: '',
    autoMode: false,
  })
})

it('clears only the opened mode’s new-app history and preserves Studio history', () => {
  const newVersions = 'workflow-gen-workflow-new-versions'
  const newIndex = 'workflow-gen-workflow-new-version-index'
  const otherMode = 'workflow-gen-advanced-chat-new-versions'
  const studio = 'workflow-gen-workflow-app-42-versions'
  sessionStorage.setItem(newVersions, 'old workflow')
  sessionStorage.setItem(newIndex, '3')
  sessionStorage.setItem(otherMode, 'chat history')
  sessionStorage.setItem(studio, 'studio history')
  store
    .getState()
    .openGenerator({ mode: 'workflow', currentAppId: 'app-42', currentAppMode: 'workflow' })
  expect(sessionStorage.getItem(studio)).toBe('studio history')
  expect(sessionStorage.getItem(newVersions)).toBe('old workflow')
  store.getState().openGenerator({ mode: 'workflow' })
  expect(sessionStorage.getItem(newVersions)).toBeNull()
  expect(sessionStorage.getItem(newIndex)).toBeNull()
  expect(sessionStorage.getItem(otherMode)).toBe('chat history')
  expect(sessionStorage.getItem(studio)).toBe('studio history')
})

it('still opens when storage access is denied', () => {
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('Access denied')
  })
  store.getState().openGenerator({ mode: 'advanced-chat' })
  expect(store.getState()).toMatchObject({ isOpen: true, mode: 'advanced-chat' })
})

it('can open without a browser window', () => {
  vi.stubGlobal('window', undefined)
  store.getState().openGenerator({ mode: 'workflow' })
  expect(store.getState().isOpen).toBe(true)
})
