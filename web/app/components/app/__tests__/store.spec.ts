import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'

type AppDetailState = Parameters<ReturnType<typeof useStore.getState>['setAppDetail']>[0]
type CurrentLogItemState = Parameters<ReturnType<typeof useStore.getState>['setCurrentLogItem']>[0]

const resetStore = () => {
  useStore.setState({
    appDetail: undefined,
    appSidebarExpand: '',
    currentLogItem: undefined,
    currentLogModalActiveTab: 'DETAIL',
    showPromptLogModal: false,
    showAgentLogModal: false,
    showMessageLogModal: false,
    showAppConfigureFeaturesModal: false,
    needsRuntimeUpgrade: false,
  })
}

describe('app store', () => {
  beforeEach(() => {
    resetStore()
  })

  it('should update each primitive flag via dedicated setters', () => {
    const store = useStore.getState()

    store.setAppSidebarExpand('collapse')
    store.setShowPromptLogModal(true)
    store.setShowAgentLogModal(true)
    store.setShowAppConfigureFeaturesModal(true)
    store.setNeedsRuntimeUpgrade(true)

    const nextState = useStore.getState()
    expect(nextState.appSidebarExpand).toBe('collapse')
    expect(nextState.showPromptLogModal).toBe(true)
    expect(nextState.showAgentLogModal).toBe(true)
    expect(nextState.showAppConfigureFeaturesModal).toBe(true)
    expect(nextState.needsRuntimeUpgrade).toBe(true)
  })

  it('should store app detail and current log item', () => {
    const appDetail = { id: 'app-1', name: 'Demo App' } as AppDetailState
    const logItem: Exclude<CurrentLogItemState, undefined> = {
      id: 'log-1',
      content: 'hello',
      isAnswer: true,
    }
    const store = useStore.getState()

    store.setAppDetail(appDetail)
    store.setCurrentLogItem(logItem)
    store.setCurrentLogModalActiveTab('TRACES')

    const nextState = useStore.getState()
    expect(nextState.appDetail).toEqual(appDetail)
    expect(nextState.currentLogItem).toEqual(logItem)
    expect(nextState.currentLogModalActiveTab).toBe('TRACES')
  })

  it('should preserve currentLogModalActiveTab when opening message log modal', () => {
    useStore.setState({ currentLogModalActiveTab: 'AGENT' })

    useStore.getState().setShowMessageLogModal(true)

    const nextState = useStore.getState()
    expect(nextState.showMessageLogModal).toBe(true)
    expect(nextState.currentLogModalActiveTab).toBe('AGENT')
  })

  it('should reset currentLogModalActiveTab to DETAIL when closing message log modal', () => {
    useStore.setState({
      currentLogModalActiveTab: 'PROMPT',
      showMessageLogModal: true,
    })

    useStore.getState().setShowMessageLogModal(false)

    const nextState = useStore.getState()
    expect(nextState.showMessageLogModal).toBe(false)
    expect(nextState.currentLogModalActiveTab).toBe('DETAIL')
  })
})
