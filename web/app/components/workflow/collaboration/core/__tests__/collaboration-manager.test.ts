import type { LoroMap } from 'loro-crdt'
import type {
  NodePanelPresenceMap,
  NodePanelPresenceUser,
} from '@/app/components/workflow/collaboration/types/collaboration'
import type { CommonNodeType, Edge, Node } from '@/app/components/workflow/types'
import { LoroDoc } from 'loro-crdt'
import { Position } from 'reactflow'
import { CollaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { BlockEnum } from '@/app/components/workflow/types'

const NODE_ID = '1760342909316'

type WorkflowVariable = {
  default: string
  hint: string
  label: string
  max_length: number
  options: string[]
  placeholder: string
  required: boolean
  type: string
  variable: string
}

type PromptTemplateItem = {
  id: string
  role: string
  text: string
}

type ParameterItem = {
  description: string
  name: string
  required: boolean
  type: string
}

type NodePanelPresenceEventData = {
  nodeId: string
  action: 'open' | 'close'
  user: NodePanelPresenceUser
  clientId: string
  timestamp?: number
}

type StartNodeData = {
  variables: WorkflowVariable[]
}

type LLMNodeData = {
  context: {
    enabled: boolean
    variable_selector: string[]
  }
  model: {
    mode: string
    name: string
    provider: string
    completion_params: {
      temperature: number
    }
  }
  prompt_template: PromptTemplateItem[]
  vision: {
    enabled: boolean
  }
}

type ParameterExtractorNodeData = {
  model: {
    mode: string
    name: string
    provider: string
    completion_params: {
      temperature: number
    }
  }
  parameters: ParameterItem[]
  query: unknown[]
  reasoning_mode: string
  vision: {
    enabled: boolean
  }
}

type LLMNodeDataWithUnknownTemplate = Omit<LLMNodeData, 'prompt_template'> & {
  prompt_template: unknown
}

type ManagerDoc = LoroDoc | { commit: () => void }

type CollaborationManagerInternals = {
  doc: ManagerDoc
  nodesMap: LoroMap
  edgesMap: LoroMap
  syncNodes: (oldNodes: Node[], newNodes: Node[]) => void
  syncEdges: (oldEdges: Edge[], newEdges: Edge[]) => void
  applyNodePanelPresenceUpdate: (update: NodePanelPresenceEventData) => void
  forceDisconnect: () => void
  activeConnections: Set<string>
  isUndoRedoInProgress: boolean
}

const createVariable = (name: string, overrides: Partial<WorkflowVariable> = {}): WorkflowVariable => ({
  default: '',
  hint: '',
  label: name,
  max_length: 48,
  options: [],
  placeholder: '',
  required: true,
  type: 'text-input',
  variable: name,
  ...overrides,
})

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const createNodeSnapshot = (variableNames: string[]): Node<StartNodeData> => ({
  id: NODE_ID,
  type: 'custom',
  position: { x: 0, y: 24 },
  positionAbsolute: { x: 0, y: 24 },
  height: 88,
  width: 242,
  selected: true,
  selectable: true,
  draggable: true,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  data: {
    selected: true,
    title: '开始',
    desc: '',
    type: BlockEnum.Start,
    variables: variableNames.map(name => createVariable(name)),
  },
})

const LLM_NODE_ID = 'llm-node'
const PARAM_NODE_ID = 'param-extractor-node'

const createLLMNodeSnapshot = (promptTemplates: PromptTemplateItem[]): Node<LLMNodeData> => ({
  id: LLM_NODE_ID,
  type: 'custom',
  position: { x: 200, y: 120 },
  positionAbsolute: { x: 200, y: 120 },
  height: 320,
  width: 460,
  selected: false,
  selectable: true,
  draggable: true,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  data: {
    type: BlockEnum.LLM,
    title: 'LLM',
    desc: '',
    selected: false,
    context: {
      enabled: false,
      variable_selector: [],
    },
    model: {
      mode: 'chat',
      name: 'gemini-2.5-pro',
      provider: 'langgenius/gemini/google',
      completion_params: {
        temperature: 0.7,
      },
    },
    vision: {
      enabled: false,
    },
    prompt_template: promptTemplates,
  },
})

const createParameterExtractorNodeSnapshot = (parameters: ParameterItem[]): Node<ParameterExtractorNodeData> => ({
  id: PARAM_NODE_ID,
  type: 'custom',
  position: { x: 420, y: 220 },
  positionAbsolute: { x: 420, y: 220 },
  height: 260,
  width: 420,
  selected: true,
  selectable: true,
  draggable: true,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  data: {
    type: BlockEnum.ParameterExtractor,
    title: '参数提取器',
    desc: '',
    selected: true,
    model: {
      mode: 'chat',
      name: '',
      provider: '',
      completion_params: {
        temperature: 0.7,
      },
    },
    reasoning_mode: 'prompt',
    parameters,
    query: [],
    vision: {
      enabled: false,
    },
  },
})

const getVariables = (node: Node): string[] => {
  const data = node.data as CommonNodeType<{ variables?: WorkflowVariable[] }>
  const variables = data.variables ?? []
  return variables.map(item => item.variable)
}

const getVariableObject = (node: Node, name: string): WorkflowVariable | undefined => {
  const data = node.data as CommonNodeType<{ variables?: WorkflowVariable[] }>
  const variables = data.variables ?? []
  return variables.find(item => item.variable === name)
}

const getPromptTemplates = (node: Node): PromptTemplateItem[] => {
  const data = node.data as CommonNodeType<{ prompt_template?: PromptTemplateItem[] }>
  return data.prompt_template ?? []
}

const getParameters = (node: Node): ParameterItem[] => {
  const data = node.data as CommonNodeType<{ parameters?: ParameterItem[] }>
  return data.parameters ?? []
}

const getManagerInternals = (manager: CollaborationManager): CollaborationManagerInternals =>
  manager as unknown as CollaborationManagerInternals

const setupManager = (): { manager: CollaborationManager, internals: CollaborationManagerInternals } => {
  const manager = new CollaborationManager()
  const doc = new LoroDoc()
  const internals = getManagerInternals(manager)
  internals.doc = doc
  internals.nodesMap = doc.getMap('nodes')
  internals.edgesMap = doc.getMap('edges')
  return { manager, internals }
}

describe('CollaborationManager syncNodes', () => {
  let manager: CollaborationManager
  let internals: CollaborationManagerInternals

  beforeEach(() => {
    const setup = setupManager()
    manager = setup.manager
    internals = setup.internals

    const initialNode = createNodeSnapshot(['a'])
    internals.syncNodes([], [deepClone(initialNode)])
  })

  it('updates collaborators map when a single client adds a variable', () => {
    const base = [createNodeSnapshot(['a'])]
    const next = [createNodeSnapshot(['a', 'b'])]

    internals.syncNodes(base, next)

    const stored = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    expect(stored).toBeDefined()
    expect(getVariables(stored!)).toEqual(['a', 'b'])
  })

  it('applies the latest parallel additions derived from the same base snapshot', () => {
    const base = [createNodeSnapshot(['a'])]
    const userA = [createNodeSnapshot(['a', 'b'])]
    const userB = [createNodeSnapshot(['a', 'c'])]

    internals.syncNodes(base, userA)

    const afterUserA = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    expect(getVariables(afterUserA!)).toEqual(['a', 'b'])

    internals.syncNodes(base, userB)

    const finalNode = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    const finalVariables = getVariables(finalNode!)

    expect(finalVariables).toEqual(['a', 'c'])
  })

  it('prefers the incoming mutation when the same variable is edited concurrently', () => {
    const base = [createNodeSnapshot(['a'])]
    const userA = [
      {
        ...createNodeSnapshot(['a']),
        data: {
          ...createNodeSnapshot(['a']).data,
          variables: [
            createVariable('a', { label: 'A from userA', hint: 'hintA' }),
          ],
        },
      },
    ]
    const userB = [
      {
        ...createNodeSnapshot(['a']),
        data: {
          ...createNodeSnapshot(['a']).data,
          variables: [
            createVariable('a', { label: 'A from userB', hint: 'hintB' }),
          ],
        },
      },
    ]

    internals.syncNodes(base, userA)
    internals.syncNodes(base, userB)

    const finalNode = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    const finalVariable = getVariableObject(finalNode!, 'a')

    expect(finalVariable?.label).toBe('A from userB')
    expect(finalVariable?.hint).toBe('hintB')
  })

  it('reflects the last writer when concurrent removal and edits happen', () => {
    const base = [createNodeSnapshot(['a', 'b'])]
    internals.syncNodes([], [deepClone(base[0])])
    const userA = [
      {
        ...createNodeSnapshot(['a']),
        data: {
          ...createNodeSnapshot(['a']).data,
          variables: [
            createVariable('a', { label: 'A after deletion' }),
          ],
        },
      },
    ]
    const userB = [
      {
        ...createNodeSnapshot(['a', 'b']),
        data: {
          ...createNodeSnapshot(['a']).data,
          variables: [
            createVariable('a'),
            createVariable('b', { label: 'B edited but should vanish' }),
          ],
        },
      },
    ]

    internals.syncNodes(base, userA)
    internals.syncNodes(base, userB)

    const finalNode = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    const finalVariables = getVariables(finalNode!)
    expect(finalVariables).toEqual(['a', 'b'])
    expect(getVariableObject(finalNode!, 'b')).toBeDefined()
  })

  it('synchronizes prompt_template list updates across collaborators', () => {
    const { manager: promptManager, internals: promptInternals } = setupManager()

    const baseTemplate = [
      {
        id: 'abcfa5f9-3c44-4252-aeba-4b6eaf0acfc4',
        role: 'system',
        text: 'avc',
      },
    ]

    const baseNode = createLLMNodeSnapshot(baseTemplate)
    promptInternals.syncNodes([], [deepClone(baseNode)])

    const updatedTemplates = [
      ...baseTemplate,
      {
        id: 'user-1',
        role: 'user',
        text: 'hello world',
      },
    ]

    const updatedNode = createLLMNodeSnapshot(updatedTemplates)
    promptInternals.syncNodes([deepClone(baseNode)], [deepClone(updatedNode)])

    const stored = (promptManager.getNodes() as Node[]).find(node => node.id === LLM_NODE_ID)
    expect(stored).toBeDefined()

    const storedTemplates = getPromptTemplates(stored!)
    expect(storedTemplates).toHaveLength(2)
    expect(storedTemplates[0]).toEqual(baseTemplate[0])
    expect(storedTemplates[1]).toEqual(updatedTemplates[1])

    const editedTemplates = [
      {
        id: 'abcfa5f9-3c44-4252-aeba-4b6eaf0acfc4',
        role: 'system',
        text: 'updated system prompt',
      },
    ]
    const editedNode = createLLMNodeSnapshot(editedTemplates)

    promptInternals.syncNodes([deepClone(updatedNode)], [deepClone(editedNode)])

    const final = (promptManager.getNodes() as Node[]).find(node => node.id === LLM_NODE_ID)
    const finalTemplates = getPromptTemplates(final!)
    expect(finalTemplates).toHaveLength(1)
    expect(finalTemplates[0].text).toBe('updated system prompt')
  })

  it('keeps parameter list in sync when nodes add, edit, or remove parameters', () => {
    const { manager: parameterManager, internals: parameterInternals } = setupManager()

    const baseParameters: ParameterItem[] = [
      { description: 'bb', name: 'aa', required: false, type: 'string' },
      { description: 'dd', name: 'cc', required: false, type: 'string' },
    ]

    const baseNode = createParameterExtractorNodeSnapshot(baseParameters)
    parameterInternals.syncNodes([], [deepClone(baseNode)])

    const updatedParameters: ParameterItem[] = [
      ...baseParameters,
      { description: 'ff', name: 'ee', required: true, type: 'number' },
    ]

    const updatedNode = createParameterExtractorNodeSnapshot(updatedParameters)
    parameterInternals.syncNodes([deepClone(baseNode)], [deepClone(updatedNode)])

    const stored = (parameterManager.getNodes() as Node[]).find(node => node.id === PARAM_NODE_ID)
    expect(stored).toBeDefined()
    expect(getParameters(stored!)).toEqual(updatedParameters)

    const editedParameters: ParameterItem[] = [
      { description: 'bb edited', name: 'aa', required: true, type: 'string' },
    ]
    const editedNode = createParameterExtractorNodeSnapshot(editedParameters)

    parameterInternals.syncNodes([deepClone(updatedNode)], [deepClone(editedNode)])

    const final = (parameterManager.getNodes() as Node[]).find(node => node.id === PARAM_NODE_ID)
    expect(getParameters(final!)).toEqual(editedParameters)
  })

  it('handles nodes without data gracefully', () => {
    const emptyNode: Node = {
      id: 'empty-node',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: undefined as unknown as CommonNodeType<Record<string, never>>,
    }

    internals.syncNodes([], [deepClone(emptyNode)])

    const stored = (manager.getNodes() as Node[]).find(node => node.id === 'empty-node')
    expect(stored).toBeDefined()
    expect(stored?.data).toEqual({})
  })

  it('preserves CRDT list instances when synchronizing parsed state back into the manager', () => {
    const { manager: promptManager, internals: promptInternals } = setupManager()

    const base = createLLMNodeSnapshot([
      { id: 'system', role: 'system', text: 'base' },
    ])
    promptInternals.syncNodes([], [deepClone(base)])

    const storedBefore = promptManager.getNodes().find(node => node.id === LLM_NODE_ID) as Node<LLMNodeData> | undefined
    expect(storedBefore).toBeDefined()
    const firstTemplate = storedBefore?.data.prompt_template?.[0]
    expect(firstTemplate?.text).toBe('base')

    // simulate consumer mutating the plain JSON array and syncing back
    const baseNode = storedBefore!
    const mutatedNode = deepClone(baseNode)
    mutatedNode.data.prompt_template.push({
      id: 'user',
      role: 'user',
      text: 'mutated',
    })

    promptInternals.syncNodes([baseNode], [mutatedNode])

    const storedAfter = promptManager.getNodes().find(node => node.id === LLM_NODE_ID) as Node<LLMNodeData> | undefined
    const templatesAfter = storedAfter?.data.prompt_template
    expect(Array.isArray(templatesAfter)).toBe(true)
    expect(templatesAfter).toHaveLength(2)
  })

  it('reuses CRDT list when syncing parameters repeatedly', () => {
    const { manager: parameterManager, internals: parameterInternals } = setupManager()

    const initialParameters: ParameterItem[] = [
      { description: 'desc', name: 'param', required: false, type: 'string' },
    ]
    const node = createParameterExtractorNodeSnapshot(initialParameters)
    parameterInternals.syncNodes([], [deepClone(node)])

    const stored = parameterManager.getNodes().find(n => n.id === PARAM_NODE_ID) as Node<ParameterExtractorNodeData>
    const mutatedNode = deepClone(stored)
    mutatedNode.data.parameters[0].description = 'updated'

    parameterInternals.syncNodes([stored], [mutatedNode])

    const storedAfter = parameterManager.getNodes().find(n => n.id === PARAM_NODE_ID) as
      | Node<ParameterExtractorNodeData>
      | undefined
    const params = storedAfter?.data.parameters ?? []
    expect(params).toHaveLength(1)
    expect(params[0].description).toBe('updated')
  })

  it('filters out transient/private data keys while keeping allowlisted ones', () => {
    const nodeWithPrivate: Node<{ _foo: string, variables: WorkflowVariable[] }> = {
      id: 'private-node',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.Start,
        title: 'private',
        desc: '',
        _foo: 'should disappear',
        _children: [{ nodeId: 'child-a', nodeType: BlockEnum.Start }],
        selected: true,
        variables: [],
      },
    }

    internals.syncNodes([], [deepClone(nodeWithPrivate)])

    const stored = (manager.getNodes() as Node[]).find(node => node.id === 'private-node')!
    const storedData = stored.data as CommonNodeType<{ _foo?: string }>
    expect(storedData._foo).toBeUndefined()
    expect(storedData._children).toEqual([{ nodeId: 'child-a', nodeType: BlockEnum.Start }])
    expect(storedData.selected).toBeUndefined()
  })

  it('removes list fields when they are omitted in the update snapshot', () => {
    const baseNode = createNodeSnapshot(['alpha'])
    internals.syncNodes([], [deepClone(baseNode)])

    const withoutVariables: Node<StartNodeData> = {
      ...deepClone(baseNode),
      data: {
        ...deepClone(baseNode).data,
      },
    }
    delete (withoutVariables.data as CommonNodeType<{ variables?: WorkflowVariable[] }>).variables

    internals.syncNodes([deepClone(baseNode)], [withoutVariables])

    const stored = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)!
    const storedData = stored.data as CommonNodeType<{ variables?: WorkflowVariable[] }>
    expect(storedData.variables).toBeUndefined()
  })

  it('treats non-array list inputs as empty lists during synchronization', () => {
    const { manager: promptManager, internals: promptInternals } = setupManager()

    const nodeWithInvalidTemplate = createLLMNodeSnapshot([])
    promptInternals.syncNodes([], [deepClone(nodeWithInvalidTemplate)])

    const mutated = deepClone(nodeWithInvalidTemplate) as Node<LLMNodeDataWithUnknownTemplate>
    mutated.data.prompt_template = 'not-an-array'

    promptInternals.syncNodes([deepClone(nodeWithInvalidTemplate)], [mutated])

    const stored = promptManager.getNodes().find(node => node.id === LLM_NODE_ID) as Node<LLMNodeData>
    expect(Array.isArray(stored.data.prompt_template)).toBe(true)
    expect(stored.data.prompt_template).toHaveLength(0)
  })

  it('updates edges map when edges are added, modified, and removed', () => {
    const { manager: edgeManager } = setupManager()

    const edge: Edge = {
      id: 'edge-1',
      source: 'node-a',
      target: 'node-b',
      type: 'default',
      data: {
        sourceType: BlockEnum.Start,
        targetType: BlockEnum.LLM,
        _waitingRun: false,
      },
    }

    edgeManager.setEdges([], [edge])
    expect(edgeManager.getEdges()).toHaveLength(1)
    const storedEdge = edgeManager.getEdges()[0]!
    expect(storedEdge.data).toBeDefined()
    expect(storedEdge.data!._waitingRun).toBe(false)

    const updatedEdge: Edge = {
      ...edge,
      data: {
        sourceType: BlockEnum.Start,
        targetType: BlockEnum.LLM,
        _waitingRun: true,
      },
    }
    edgeManager.setEdges([edge], [updatedEdge])
    expect(edgeManager.getEdges()).toHaveLength(1)
    const updatedStoredEdge = edgeManager.getEdges()[0]!
    expect(updatedStoredEdge.data).toBeDefined()
    expect(updatedStoredEdge.data!._waitingRun).toBe(true)

    edgeManager.setEdges([updatedEdge], [])
    expect(edgeManager.getEdges()).toHaveLength(0)
  })
})

describe('CollaborationManager public API wrappers', () => {
  let manager: CollaborationManager
  let internals: CollaborationManagerInternals
  const baseNodes: Node[] = []
  const updatedNodes: Node[] = [
    {
      id: 'new-node',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.Start,
        title: 'New node',
        desc: '',
      },
    },
  ]
  const baseEdges: Edge[] = []
  const updatedEdges: Edge[] = [
    {
      id: 'edge-1',
      source: 'source',
      target: 'target',
      type: 'default',
      data: {
        sourceType: BlockEnum.Start,
        targetType: BlockEnum.End,
      },
    },
  ]

  beforeEach(() => {
    manager = new CollaborationManager()
    internals = getManagerInternals(manager)
  })

  it('setNodes delegates to syncNodes and commits the CRDT document', () => {
    const commit = vi.fn()
    internals.doc = { commit }
    const syncSpy = vi.spyOn(internals, 'syncNodes').mockImplementation(() => undefined)

    manager.setNodes(baseNodes, updatedNodes)

    expect(syncSpy).toHaveBeenCalledWith(baseNodes, updatedNodes)
    expect(commit).toHaveBeenCalled()
    syncSpy.mockRestore()
  })

  it('setNodes skips syncing when undo/redo replay is running', () => {
    const commit = vi.fn()
    internals.doc = { commit }
    internals.isUndoRedoInProgress = true
    const syncSpy = vi.spyOn(internals, 'syncNodes').mockImplementation(() => undefined)

    manager.setNodes(baseNodes, updatedNodes)

    expect(syncSpy).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    syncSpy.mockRestore()
  })

  it('setEdges delegates to syncEdges and commits the CRDT document', () => {
    const commit = vi.fn()
    internals.doc = { commit }
    const syncSpy = vi.spyOn(internals, 'syncEdges').mockImplementation(() => undefined)

    manager.setEdges(baseEdges, updatedEdges)

    expect(syncSpy).toHaveBeenCalledWith(baseEdges, updatedEdges)
    expect(commit).toHaveBeenCalled()
    syncSpy.mockRestore()
  })

  it('disconnect tears down the collaboration state only when last connection closes', () => {
    const forceSpy = vi.spyOn(internals, 'forceDisconnect').mockImplementation(() => undefined)
    internals.activeConnections.add('conn-a')
    internals.activeConnections.add('conn-b')

    manager.disconnect('conn-a')
    expect(forceSpy).not.toHaveBeenCalled()

    manager.disconnect('conn-b')
    expect(forceSpy).toHaveBeenCalledTimes(1)
    forceSpy.mockRestore()
  })

  it('applyNodePanelPresenceUpdate keeps a client visible on a single node at a time', () => {
    const updates: NodePanelPresenceMap[] = []
    manager.onNodePanelPresenceUpdate((presence) => {
      updates.push(presence)
    })

    const user: NodePanelPresenceUser = { userId: 'user-1', username: 'Dana' }

    internals.applyNodePanelPresenceUpdate({
      nodeId: 'node-a',
      action: 'open',
      user,
      clientId: 'client-1',
      timestamp: 100,
    })

    internals.applyNodePanelPresenceUpdate({
      nodeId: 'node-b',
      action: 'open',
      user,
      clientId: 'client-1',
      timestamp: 200,
    })

    const finalSnapshot = updates[updates.length - 1]!
    expect(finalSnapshot).toEqual({
      'node-b': {
        'client-1': {
          userId: 'user-1',
          username: 'Dana',
          clientId: 'client-1',
          timestamp: 200,
        },
      },
    })
  })

  it('applyNodePanelPresenceUpdate clears node entries when last viewer closes the panel', () => {
    const updates: NodePanelPresenceMap[] = []
    manager.onNodePanelPresenceUpdate((presence) => {
      updates.push(presence)
    })

    const user: NodePanelPresenceUser = { userId: 'user-2', username: 'Kai' }

    internals.applyNodePanelPresenceUpdate({
      nodeId: 'node-a',
      action: 'open',
      user,
      clientId: 'client-9',
      timestamp: 300,
    })

    internals.applyNodePanelPresenceUpdate({
      nodeId: 'node-a',
      action: 'close',
      user,
      clientId: 'client-9',
      timestamp: 301,
    })

    expect(updates[updates.length - 1]).toEqual({})
  })
})
