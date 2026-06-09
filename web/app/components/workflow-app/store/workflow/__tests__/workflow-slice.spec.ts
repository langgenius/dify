import { createStore } from 'zustand/vanilla'
import { createWorkflowSlice } from '../workflow-slice'

describe('createWorkflowSlice', () => {
  it('should initialize workflow slice state with expected defaults', () => {
    const store = createStore(createWorkflowSlice)
    const state = store.getState()

    expect(state.appId).toBe('')
    expect(state.appName).toBe('')
    expect(state.notInitialWorkflow).toBe(false)
    expect(state.shouldAutoOpenStartNodeSelector).toBe(false)
    expect(state.nodesDefaultConfigs).toEqual({})
    expect(state.showOnboarding).toBe(false)
    expect(state.hasSelectedStartNode).toBe(false)
    expect(state.hasShownOnboarding).toBe(false)
  })

  it('should update every workflow slice field through its setters', () => {
    const store = createStore(createWorkflowSlice)

    store.setState({
      appId: 'app-1',
      appName: 'Workflow App',
    })
    store.getState().setNotInitialWorkflow(true)
    store.getState().setShouldAutoOpenStartNodeSelector(true)
    store.getState().setNodesDefaultConfigs({ start: { title: 'Start' } })
    store.getState().setShowOnboarding(true)
    store.getState().setHasSelectedStartNode(true)
    store.getState().setHasShownOnboarding(true)

    expect(store.getState()).toMatchObject({
      appId: 'app-1',
      appName: 'Workflow App',
      notInitialWorkflow: true,
      shouldAutoOpenStartNodeSelector: true,
      nodesDefaultConfigs: { start: { title: 'Start' } },
      showOnboarding: true,
      hasSelectedStartNode: true,
      hasShownOnboarding: true,
    })
  })
})
