import { useStore } from '../store'

describe('app store', () => {
  beforeEach(() => {
    useStore.setState({
      currentLogModalActiveTab: 'DETAIL',
      showMessageLogModal: false,
    })
  })

  it('resets the active tab when the message log modal closes', () => {
    useStore.getState().setCurrentLogModalActiveTab('TRACE')
    useStore.getState().setShowMessageLogModal(true)

    useStore.getState().setShowMessageLogModal(false)

    expect(useStore.getState().showMessageLogModal).toBe(false)
    expect(useStore.getState().currentLogModalActiveTab).toBe('DETAIL')
  })
})
