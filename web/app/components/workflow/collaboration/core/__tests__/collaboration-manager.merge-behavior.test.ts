import type { LoroMap } from 'loro-crdt'
import type { Node } from '@/app/components/workflow/types'
import { LoroDoc } from 'loro-crdt'
import { BlockEnum } from '@/app/components/workflow/types'
import { CollaborationManager } from '../collaboration-manager'

const NODE_ID = 'node-1'
const LLM_NODE_ID = 'llm-node'
const PARAM_NODE_ID = 'parameter-node'

type WorkflowVariable = {
  variable: string
  label: string
  type: string
  required: boolean
  default: string
  max_length: number
  placeholder: string
  options: string[]
  hint: string
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

type StartNodeData = {
  variables: WorkflowVariable[]
}

type LLMNodeData = {
  model: {
    mode: string
    name: string
    provider: string
    completion_params: {
      temperature: number
    }
  }
  context: {
    enabled: boolean
    variable_selector: string[]
  }
  vision: {
    enabled: boolean
  }
  prompt_template: PromptTemplateItem[]
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

type CollaborationManagerInternals = {
  doc: LoroDoc
  nodesMap: LoroMap
  edgesMap: LoroMap
  syncNodes: (oldNodes: Node[], newNodes: Node[]) => void
}

const createNode = (variables: string[]): Node<StartNodeData> => ({
  id: NODE_ID,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Start,
    title: 'Start',
    desc: '',
    variables: variables.map(name => ({
      variable: name,
      label: name,
      type: 'text-input',
      required: true,
      default: '',
      max_length: 48,
      placeholder: '',
      options: [],
      hint: '',
    })),
  },
})

const createLLMNode = (templates: PromptTemplateItem[]): Node<LLMNodeData> => ({
  id: LLM_NODE_ID,
  type: 'custom',
  position: { x: 200, y: 200 },
  data: {
    type: BlockEnum.LLM,
    title: 'LLM',
    desc: '',
    selected: false,
    model: {
      mode: 'chat',
      name: 'gemini-2.5-pro',
      provider: 'langgenius/gemini/google',
      completion_params: {
        temperature: 0.7,
      },
    },
    context: {
      enabled: false,
      variable_selector: [],
    },
    vision: {
      enabled: false,
    },
    prompt_template: templates,
  },
})

const createParameterExtractorNode = (parameters: ParameterItem[]): Node<ParameterExtractorNodeData> => ({
  id: PARAM_NODE_ID,
  type: 'custom',
  position: { x: 400, y: 120 },
  data: {
    type: BlockEnum.ParameterExtractor,
    title: 'ParameterExtractor',
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
    query: [],
    reasoning_mode: 'prompt',
    parameters,
    vision: {
      enabled: false,
    },
  },
})

const getManagerInternals = (manager: CollaborationManager): CollaborationManagerInternals =>
  manager as unknown as CollaborationManagerInternals

const getManager = (doc: LoroDoc) => {
  const manager = new CollaborationManager()
  const internals = getManagerInternals(manager)
  internals.doc = doc
  internals.nodesMap = doc.getMap('nodes')
  internals.edgesMap = doc.getMap('edges')
  return manager
}

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const syncNodes = (manager: CollaborationManager, previous: Node[], next: Node[]) => {
  const internals = getManagerInternals(manager)
  internals.syncNodes(previous, next)
}

const exportNodes = (manager: CollaborationManager) => manager.getNodes()

describe('Loro merge behavior smoke test', () => {
  it('inspects concurrent edits after merge', () => {
    const docA = new LoroDoc()
    const managerA = getManager(docA)
    syncNodes(managerA, [], [createNode(['a'])])

    const snapshot = docA.export({ mode: 'snapshot' })

    const docB = LoroDoc.fromSnapshot(snapshot)
    const managerB = getManager(docB)

    syncNodes(managerA, [createNode(['a'])], [createNode(['a', 'b'])])
    syncNodes(managerB, [createNode(['a'])], [createNode(['a', 'c'])])

    const updateForA = docB.export({ mode: 'update', from: docA.version() })
    docA.import(updateForA)

    const updateForB = docA.export({ mode: 'update', from: docB.version() })
    docB.import(updateForB)

    const finalA = exportNodes(managerA)
    const finalB = exportNodes(managerB)
    expect(finalA.length).toBe(1)
    expect(finalB.length).toBe(1)
  })

  it('merges prompt template insertions and edits across replicas', () => {
    const baseTemplate = [
      {
        id: 'system-1',
        role: 'system',
        text: 'base instruction',
      },
    ]

    const docA = new LoroDoc()
    const managerA = getManager(docA)
    syncNodes(managerA, [], [createLLMNode(deepClone(baseTemplate))])

    const snapshot = docA.export({ mode: 'snapshot' })
    const docB = LoroDoc.fromSnapshot(snapshot)
    const managerB = getManager(docB)

    const additionTemplate = [
      ...baseTemplate,
      {
        id: 'user-1',
        role: 'user',
        text: 'hello from docA',
      },
    ]
    syncNodes(managerA, [createLLMNode(deepClone(baseTemplate))], [createLLMNode(deepClone(additionTemplate))])

    const editedTemplate = [
      {
        id: 'system-1',
        role: 'system',
        text: 'updated by docB',
      },
    ]
    syncNodes(managerB, [createLLMNode(deepClone(baseTemplate))], [createLLMNode(deepClone(editedTemplate))])

    const updateForA = docB.export({ mode: 'update', from: docA.version() })
    docA.import(updateForA)

    const updateForB = docA.export({ mode: 'update', from: docB.version() })
    docB.import(updateForB)

    const finalA = exportNodes(managerA).find(node => node.id === LLM_NODE_ID) as Node<LLMNodeData> | undefined
    const finalB = exportNodes(managerB).find(node => node.id === LLM_NODE_ID) as Node<LLMNodeData> | undefined

    expect(finalA).toBeDefined()
    expect(finalB).toBeDefined()

    const expectedTemplates = [
      {
        id: 'system-1',
        role: 'system',
        text: 'updated by docB',
      },
      {
        id: 'user-1',
        role: 'user',
        text: 'hello from docA',
      },
    ]

    expect(finalA!.data.prompt_template).toEqual(expectedTemplates)
    expect(finalB!.data.prompt_template).toEqual(expectedTemplates)
  })

  it('converges when parameter lists are edited concurrently', () => {
    const baseParameters = [
      { description: 'bb', name: 'aa', required: false, type: 'string' },
      { description: 'dd', name: 'cc', required: false, type: 'string' },
    ]

    const docA = new LoroDoc()
    const managerA = getManager(docA)
    syncNodes(managerA, [], [createParameterExtractorNode(deepClone(baseParameters))])

    const snapshot = docA.export({ mode: 'snapshot' })
    const docB = LoroDoc.fromSnapshot(snapshot)
    const managerB = getManager(docB)

    const docAUpdate = [
      { description: 'bb updated by A', name: 'aa', required: true, type: 'string' },
      { description: 'dd', name: 'cc', required: false, type: 'string' },
      { description: 'new from A', name: 'ee', required: false, type: 'number' },
    ]
    syncNodes(
      managerA,
      [createParameterExtractorNode(deepClone(baseParameters))],
      [createParameterExtractorNode(deepClone(docAUpdate))],
    )

    const docBUpdate = [
      { description: 'bb', name: 'aa', required: false, type: 'string' },
      { description: 'dd updated by B', name: 'cc', required: true, type: 'string' },
    ]
    syncNodes(
      managerB,
      [createParameterExtractorNode(deepClone(baseParameters))],
      [createParameterExtractorNode(deepClone(docBUpdate))],
    )

    const updateForA = docB.export({ mode: 'update', from: docA.version() })
    docA.import(updateForA)

    const updateForB = docA.export({ mode: 'update', from: docB.version() })
    docB.import(updateForB)

    const finalA = exportNodes(managerA).find(node => node.id === PARAM_NODE_ID) as
      | Node<ParameterExtractorNodeData>
      | undefined
    const finalB = exportNodes(managerB).find(node => node.id === PARAM_NODE_ID) as
      | Node<ParameterExtractorNodeData>
      | undefined

    expect(finalA).toBeDefined()
    expect(finalB).toBeDefined()

    const expectedParameters = [
      { description: 'bb updated by A', name: 'aa', required: true, type: 'string' },
      { description: 'dd updated by B', name: 'cc', required: true, type: 'string' },
      { description: 'new from A', name: 'ee', required: false, type: 'number' },
    ]

    expect(finalA!.data.parameters).toEqual(expectedParameters)
    expect(finalB!.data.parameters).toEqual(expectedParameters)
  })
})
