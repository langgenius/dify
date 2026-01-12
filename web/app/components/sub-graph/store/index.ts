import type { CreateSubGraphSlice, SubGraphSliceShape } from '../types'

const initialState: Omit<SubGraphSliceShape, 'setSubGraphContext' | 'setSubGraphNodes' | 'setSubGraphEdges' | 'setSelectedOutputVar' | 'setWhenOutputNone' | 'setDefaultValue' | 'setShowDebugPanel' | 'setIsRunning' | 'setParentAvailableVars' | 'resetSubGraph'> = {
  parentToolNodeId: '',
  parameterKey: '',
  sourceAgentNodeId: '',
  sourceVariable: [],

  subGraphNodes: [],
  subGraphEdges: [],

  selectedOutputVar: [],
  whenOutputNone: 'default',
  defaultValue: '',

  showDebugPanel: false,
  isRunning: false,

  parentAvailableVars: [],
}

export const createSubGraphSlice: CreateSubGraphSlice = set => ({
  ...initialState,

  setSubGraphContext: context => set(() => ({
    parentToolNodeId: context.parentToolNodeId,
    parameterKey: context.parameterKey,
    sourceAgentNodeId: context.sourceAgentNodeId,
    sourceVariable: context.sourceVariable,
  })),

  setSubGraphNodes: nodes => set(() => ({ subGraphNodes: nodes })),

  setSubGraphEdges: edges => set(() => ({ subGraphEdges: edges })),

  setSelectedOutputVar: selector => set(() => ({ selectedOutputVar: selector })),

  setWhenOutputNone: option => set(() => ({ whenOutputNone: option })),

  setDefaultValue: value => set(() => ({ defaultValue: value })),

  setShowDebugPanel: show => set(() => ({ showDebugPanel: show })),

  setIsRunning: running => set(() => ({ isRunning: running })),

  setParentAvailableVars: vars => set(() => ({ parentAvailableVars: vars })),

  resetSubGraph: () => set(() => ({ ...initialState })),
})
