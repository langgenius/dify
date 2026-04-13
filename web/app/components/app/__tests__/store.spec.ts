import { useStore } from '../store'

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
  })
}

describe('app store', () => {
  beforeEach(() => {
    resetStore()
  })

  it('should expose the default state', () => {
    expect(useStore.getState()).toEqual(expect.objectContaining({
      appDetail: undefined,
      appSidebarExpand: '',
      currentLogItem: undefined,
      currentLogModalActiveTab: 'DETAIL',
      showPromptLogModal: false,
      showAgentLogModal: false,
      showMessageLogModal: false,
      showAppConfigureFeaturesModal: false,
    }))
  })

  it('should update every mutable field through its actions', () => {
    const appDetail = { id: 'app-1' } as ReturnType<typeof useStore.getState>['appDetail']
    const currentLogItem = { id: 'message-1' } as ReturnType<typeof useStore.getState>['currentLogItem']

    useStore.getState().setAppDetail(appDetail)
    useStore.getState().setAppSidebarExpand('logs')
    useStore.getState().setCurrentLogItem(currentLogItem)
    useStore.getState().setCurrentLogModalActiveTab('MESSAGE')
    useStore.getState().setShowPromptLogModal(true)
    useStore.getState().setShowAgentLogModal(true)
    useStore.getState().setShowAppConfigureFeaturesModal(true)

    expect(useStore.getState()).toEqual(expect.objectContaining({
      appDetail,
      appSidebarExpand: 'logs',
      currentLogItem,
      currentLogModalActiveTab: 'MESSAGE',
      showPromptLogModal: true,
      showAgentLogModal: true,
      showAppConfigureFeaturesModal: true,
    }))
  })

  it('should reset the active tab when the message log modal closes', () => {
    useStore.getState().setCurrentLogModalActiveTab('TRACE')
    useStore.getState().setShowMessageLogModal(true)

    expect(useStore.getState().showMessageLogModal).toBe(true)
    expect(useStore.getState().currentLogModalActiveTab).toBe('TRACE')

    useStore.getState().setShowMessageLogModal(false)

    expect(useStore.getState().showMessageLogModal).toBe(false)
    expect(useStore.getState().currentLogModalActiveTab).toBe('DETAIL')
  })
})
