import { LoroDoc } from 'loro-crdt'
import { CollaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { BlockEnum } from '@/app/components/workflow/types'
import type { Edge, Node } from '@/app/components/workflow/types'

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

const createNodeSnapshot = (variableNames: string[]): Node<{ variables: WorkflowVariable[] }> => ({
  id: NODE_ID,
  type: 'custom',
  position: { x: 0, y: 24 },
  positionAbsolute: { x: 0, y: 24 },
  height: 88,
  width: 242,
  selected: true,
  selectable: true,
  draggable: true,
  sourcePosition: 'right',
  targetPosition: 'left',
  data: {
    selected: true,
    title: '开始',
    desc: '',
    type: BlockEnum.Start,
    variables: variableNames.map(createVariable),
  },
})

const LLM_NODE_ID = 'llm-node'
const PARAM_NODE_ID = 'param-extractor-node'

const createLLMNodeSnapshot = (promptTemplates: PromptTemplateItem[]): Node<any> => ({
  id: LLM_NODE_ID,
  type: 'custom',
  position: { x: 200, y: 120 },
  positionAbsolute: { x: 200, y: 120 },
  height: 320,
  width: 460,
  selected: false,
  selectable: true,
  draggable: true,
  sourcePosition: 'right',
  targetPosition: 'left',
  data: {
    type: 'llm',
    title: 'LLM',
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

const createParameterExtractorNodeSnapshot = (parameters: ParameterItem[]): Node<any> => ({
  id: PARAM_NODE_ID,
  type: 'custom',
  position: { x: 420, y: 220 },
  positionAbsolute: { x: 420, y: 220 },
  height: 260,
  width: 420,
  selected: true,
  selectable: true,
  draggable: true,
  sourcePosition: 'right',
  targetPosition: 'left',
  data: {
    type: 'parameter-extractor',
    title: '参数提取器',
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
  const variables = (node.data as any)?.variables ?? []
  return variables.map((item: WorkflowVariable) => item.variable)
}

const getVariableObject = (node: Node, name: string): WorkflowVariable | undefined => {
  const variables = (node.data as any)?.variables ?? []
  return variables.find((item: WorkflowVariable) => item.variable === name)
}

const getPromptTemplates = (node: Node): PromptTemplateItem[] => {
  return ((node.data as any)?.prompt_template ?? []) as PromptTemplateItem[]
}

const getParameters = (node: Node): ParameterItem[] => {
  return ((node.data as any)?.parameters ?? []) as ParameterItem[]
}

describe('CollaborationManager syncNodes', () => {
  let manager: CollaborationManager

  beforeEach(() => {
    manager = new CollaborationManager()
    // Bypass private guards for targeted unit testing
    const doc = new LoroDoc()
    ;(manager as any).doc = doc
    ;(manager as any).nodesMap = doc.getMap('nodes')
    ;(manager as any).edgesMap = doc.getMap('edges')

    const initialNode = createNodeSnapshot(['a'])
    ;(manager as any).syncNodes([], [deepClone(initialNode)])
  })

  it('updates collaborators map when a single client adds a variable', () => {
    const base = [createNodeSnapshot(['a'])]
    const next = [createNodeSnapshot(['a', 'b'])]

    ;(manager as any).syncNodes(base, next)

    const stored = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    expect(stored).toBeDefined()
    expect(getVariables(stored!)).toEqual(['a', 'b'])
  })

  it('applies the latest parallel additions derived from the same base snapshot', () => {
    const base = [createNodeSnapshot(['a'])]
    const userA = [createNodeSnapshot(['a', 'b'])]
    const userB = [createNodeSnapshot(['a', 'c'])]

    ;(manager as any).syncNodes(base, userA)

    const afterUserA = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    expect(getVariables(afterUserA!)).toEqual(['a', 'b'])

    ;(manager as any).syncNodes(base, userB)

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

    ;(manager as any).syncNodes(base, userA)
    ;(manager as any).syncNodes(base, userB)

    const finalNode = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    const finalVariable = getVariableObject(finalNode!, 'a')

    expect(finalVariable?.label).toBe('A from userB')
    expect(finalVariable?.hint).toBe('hintB')
  })

  it('reflects the last writer when concurrent removal and edits happen', () => {
    const base = [createNodeSnapshot(['a', 'b'])]
    ;(manager as any).syncNodes([], [deepClone(base[0])])
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

    ;(manager as any).syncNodes(base, userA)
    ;(manager as any).syncNodes(base, userB)

    const finalNode = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)
    const finalVariables = getVariables(finalNode!)
    expect(finalVariables).toEqual(['a', 'b'])
    expect(getVariableObject(finalNode!, 'b')).toBeDefined()
  })

  it('synchronizes prompt_template list updates across collaborators', () => {
    const promptManager = new CollaborationManager()
    const doc = new LoroDoc()
    ;(promptManager as any).doc = doc
    ;(promptManager as any).nodesMap = doc.getMap('nodes')
    ;(promptManager as any).edgesMap = doc.getMap('edges')

    const baseTemplate = [
      {
        id: 'abcfa5f9-3c44-4252-aeba-4b6eaf0acfc4',
        role: 'system',
        text: 'avc',
      },
    ]

    const baseNode = createLLMNodeSnapshot(baseTemplate)
    ;(promptManager as any).syncNodes([], [deepClone(baseNode)])

    const updatedTemplates = [
      ...baseTemplate,
      {
        id: 'user-1',
        role: 'user',
        text: 'hello world',
      },
    ]

    const updatedNode = createLLMNodeSnapshot(updatedTemplates)
    ;(promptManager as any).syncNodes([deepClone(baseNode)], [deepClone(updatedNode)])

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

    ;(promptManager as any).syncNodes([deepClone(updatedNode)], [deepClone(editedNode)])

    const final = (promptManager.getNodes() as Node[]).find(node => node.id === LLM_NODE_ID)
    const finalTemplates = getPromptTemplates(final!)
    expect(finalTemplates).toHaveLength(1)
    expect(finalTemplates[0].text).toBe('updated system prompt')
  })

  it('keeps parameter list in sync when nodes add, edit, or remove parameters', () => {
    const parameterManager = new CollaborationManager()
    const doc = new LoroDoc()
    ;(parameterManager as any).doc = doc
    ;(parameterManager as any).nodesMap = doc.getMap('nodes')
    ;(parameterManager as any).edgesMap = doc.getMap('edges')

    const baseParameters: ParameterItem[] = [
      { description: 'bb', name: 'aa', required: false, type: 'string' },
      { description: 'dd', name: 'cc', required: false, type: 'string' },
    ]

    const baseNode = createParameterExtractorNodeSnapshot(baseParameters)
    ;(parameterManager as any).syncNodes([], [deepClone(baseNode)])

    const updatedParameters: ParameterItem[] = [
      ...baseParameters,
      { description: 'ff', name: 'ee', required: true, type: 'number' },
    ]

    const updatedNode = createParameterExtractorNodeSnapshot(updatedParameters)
    ;(parameterManager as any).syncNodes([deepClone(baseNode)], [deepClone(updatedNode)])

    const stored = (parameterManager.getNodes() as Node[]).find(node => node.id === PARAM_NODE_ID)
    expect(stored).toBeDefined()
    expect(getParameters(stored!)).toEqual(updatedParameters)

    const editedParameters: ParameterItem[] = [
      { description: 'bb edited', name: 'aa', required: true, type: 'string' },
    ]
    const editedNode = createParameterExtractorNodeSnapshot(editedParameters)

    ;(parameterManager as any).syncNodes([deepClone(updatedNode)], [deepClone(editedNode)])

    const final = (parameterManager.getNodes() as Node[]).find(node => node.id === PARAM_NODE_ID)
    expect(getParameters(final!)).toEqual(editedParameters)
  })

  it('handles nodes without data gracefully', () => {
    const emptyNode: Node = {
      id: 'empty-node',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: undefined as any,
    }

    ;(manager as any).syncNodes([], [deepClone(emptyNode)])

    const stored = (manager.getNodes() as Node[]).find(node => node.id === 'empty-node')
    expect(stored).toBeDefined()
    expect(stored?.data).toEqual({})
  })

  it('preserves CRDT list instances when synchronizing parsed state back into the manager', () => {
    const promptManager = new CollaborationManager()
    const doc = new LoroDoc()
    ;(promptManager as any).doc = doc
    ;(promptManager as any).nodesMap = doc.getMap('nodes')
    ;(promptManager as any).edgesMap = doc.getMap('edges')

    const base = createLLMNodeSnapshot([
      { id: 'system', role: 'system', text: 'base' },
    ])
    ;(promptManager as any).syncNodes([], [deepClone(base)])

    const storedBefore = promptManager.getNodes().find(node => node.id === LLM_NODE_ID)
    const firstTemplate = (storedBefore?.data as any).prompt_template?.[0]
    expect(firstTemplate?.text).toBe('base')

    // simulate consumer mutating the plain JSON array and syncing back
    const mutatedNode = deepClone(storedBefore!)
    mutatedNode.data.prompt_template.push({
      id: 'user',
      role: 'user',
      text: 'mutated',
    })

    ;(promptManager as any).syncNodes([storedBefore], [mutatedNode])

    const storedAfter = promptManager.getNodes().find(node => node.id === LLM_NODE_ID)
    const templatesAfter = (storedAfter?.data as any).prompt_template
    expect(Array.isArray(templatesAfter)).toBe(true)
    expect(templatesAfter).toHaveLength(2)
  })

  it('reuses CRDT list when syncing parameters repeatedly', () => {
    const parameterManager = new CollaborationManager()
    const doc = new LoroDoc()
    ;(parameterManager as any).doc = doc
    ;(parameterManager as any).nodesMap = doc.getMap('nodes')
    ;(parameterManager as any).edgesMap = doc.getMap('edges')

    const initialParameters: ParameterItem[] = [
      { description: 'desc', name: 'param', required: false, type: 'string' },
    ]
    const node = createParameterExtractorNodeSnapshot(initialParameters)
    ;(parameterManager as any).syncNodes([], [deepClone(node)])

    const stored = parameterManager.getNodes().find(n => n.id === PARAM_NODE_ID)!
    const mutatedNode = deepClone(stored)
    mutatedNode.data.parameters[0].description = 'updated'

    ;(parameterManager as any).syncNodes([stored], [mutatedNode])

    const storedAfter = parameterManager.getNodes().find(n => n.id === PARAM_NODE_ID)!
    const params = (storedAfter.data as any).parameters
    expect(params).toHaveLength(1)
    expect(params[0].description).toBe('updated')
  })

  it('filters out transient/private data keys while keeping allowlisted ones', () => {
    const nodeWithPrivate: Node = {
      id: 'private-node',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.Start,
        _foo: 'should disappear',
        _children: ['child-a'],
        selected: true,
        variables: [],
      },
    }

    ;(manager as any).syncNodes([], [deepClone(nodeWithPrivate)])

    const stored = (manager.getNodes() as Node[]).find(node => node.id === 'private-node')!
    expect((stored.data as any)._foo).toBeUndefined()
    expect((stored.data as any)._children).toEqual(['child-a'])
    expect((stored.data as any).selected).toBeUndefined()
  })

  it('removes list fields when they are omitted in the update snapshot', () => {
    const baseNode = createNodeSnapshot(['alpha'])
    ;(manager as any).syncNodes([], [deepClone(baseNode)])

    const withoutVariables: Node = {
      ...deepClone(baseNode),
      data: {
        ...deepClone(baseNode).data,
      },
    }
    delete (withoutVariables.data as any).variables

    ;(manager as any).syncNodes([deepClone(baseNode)], [withoutVariables])

    const stored = (manager.getNodes() as Node[]).find(node => node.id === NODE_ID)!
    expect((stored.data as any).variables).toBeUndefined()
  })

  it('treats non-array list inputs as empty lists during synchronization', () => {
    const promptManager = new CollaborationManager()
    const doc = new LoroDoc()
    ;(promptManager as any).doc = doc
    ;(promptManager as any).nodesMap = doc.getMap('nodes')
    ;(promptManager as any).edgesMap = doc.getMap('edges')

    const nodeWithInvalidTemplate = createLLMNodeSnapshot([] as any)
    ;(promptManager as any).syncNodes([], [deepClone(nodeWithInvalidTemplate)])

    const mutated = deepClone(nodeWithInvalidTemplate)
    ;(mutated.data as any).prompt_template = 'not-an-array'

    ;(promptManager as any).syncNodes([deepClone(nodeWithInvalidTemplate)], [mutated])

    const stored = promptManager.getNodes().find(node => node.id === LLM_NODE_ID)!
    expect(Array.isArray((stored.data as any).prompt_template)).toBe(true)
    expect((stored.data as any).prompt_template).toHaveLength(0)
  })

  it('updates edges map when edges are added, modified, and removed', () => {
    const edgeManager = new CollaborationManager()
    const doc = new LoroDoc()
    ;(edgeManager as any).doc = doc
    ;(edgeManager as any).nodesMap = doc.getMap('nodes')
    ;(edgeManager as any).edgesMap = doc.getMap('edges')

    const edge: Edge = {
      id: 'edge-1',
      source: 'node-a',
      target: 'node-b',
      type: 'default',
      data: { label: 'initial' },
    } as Edge

    ;(edgeManager as any).setEdges([], [edge])
    expect(edgeManager.getEdges()).toHaveLength(1)
    expect((edgeManager.getEdges()[0].data as any).label).toBe('initial')

    const updatedEdge: Edge = {
      ...edge,
      data: { label: 'updated' },
    }
    ;(edgeManager as any).setEdges([edge], [updatedEdge])
    expect(edgeManager.getEdges()).toHaveLength(1)
    expect((edgeManager.getEdges()[0].data as any).label).toBe('updated')

    ;(edgeManager as any).setEdges([updatedEdge], [])
    expect(edgeManager.getEdges()).toHaveLength(0)
  })
})
