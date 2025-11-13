import { LoroDoc } from 'loro-crdt'
import { CollaborationManager } from '../collaboration-manager'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

const NODE_ID = 'node-1'
const LLM_NODE_ID = 'llm-node'
const PARAM_NODE_ID = 'parameter-node'

const createNode = (variables: string[]): Node => ({
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

const createLLMNode = (templates: Array<{ id: string; role: string; text: string }>): Node => ({
  id: LLM_NODE_ID,
  type: 'custom',
  position: { x: 200, y: 200 },
  data: {
    type: BlockEnum.LLM,
    title: 'LLM',
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

const createParameterExtractorNode = (parameters: Array<{ description: string; name: string; required: boolean; type: string }>): Node => ({
  id: PARAM_NODE_ID,
  type: 'custom',
  position: { x: 400, y: 120 },
  data: {
    type: BlockEnum.ParameterExtractor,
    title: 'ParameterExtractor',
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

const getManager = (doc: LoroDoc) => {
  const manager = new CollaborationManager()
  ;(manager as any).doc = doc
  ;(manager as any).nodesMap = doc.getMap('nodes')
  ;(manager as any).edgesMap = doc.getMap('edges')
  return manager
}

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const exportNodes = (manager: CollaborationManager) => manager.getNodes()

describe('Loro merge behavior smoke test', () => {
  it('inspects concurrent edits after merge', () => {
    const docA = new LoroDoc()
    const managerA = getManager(docA)
    managerA.syncNodes([], [createNode(['a'])])

    const snapshot = docA.export({ mode: 'snapshot' })

    const docB = LoroDoc.fromSnapshot(snapshot)
    const managerB = getManager(docB)

    managerA.syncNodes([createNode(['a'])], [createNode(['a', 'b'])])
    managerB.syncNodes([createNode(['a'])], [createNode(['a', 'c'])])

    const updateForA = docB.export({ mode: 'update', from: docA.version() })
    docA.import(updateForA)

    const updateForB = docA.export({ mode: 'update', from: docB.version() })
    docB.import(updateForB)

    const finalA = exportNodes(managerA)
    const finalB = exportNodes(managerB)

    console.log('Final nodes on docA:', JSON.stringify(finalA, null, 2))

    console.log('Final nodes on docB:', JSON.stringify(finalB, null, 2))
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
    managerA.syncNodes([], [createLLMNode(deepClone(baseTemplate))])

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
    managerA.syncNodes([createLLMNode(deepClone(baseTemplate))], [createLLMNode(deepClone(additionTemplate))])

    const editedTemplate = [
      {
        id: 'system-1',
        role: 'system',
        text: 'updated by docB',
      },
    ]
    managerB.syncNodes([createLLMNode(deepClone(baseTemplate))], [createLLMNode(deepClone(editedTemplate))])

    const updateForA = docB.export({ mode: 'update', from: docA.version() })
    docA.import(updateForA)

    const updateForB = docA.export({ mode: 'update', from: docB.version() })
    docB.import(updateForB)

    const finalA = exportNodes(managerA).find(node => node.id === LLM_NODE_ID)
    const finalB = exportNodes(managerB).find(node => node.id === LLM_NODE_ID)

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

    expect((finalA!.data as any).prompt_template).toEqual(expectedTemplates)
    expect((finalB!.data as any).prompt_template).toEqual(expectedTemplates)
  })

  it('converges when parameter lists are edited concurrently', () => {
    const baseParameters = [
      { description: 'bb', name: 'aa', required: false, type: 'string' },
      { description: 'dd', name: 'cc', required: false, type: 'string' },
    ]

    const docA = new LoroDoc()
    const managerA = getManager(docA)
    managerA.syncNodes([], [createParameterExtractorNode(deepClone(baseParameters))])

    const snapshot = docA.export({ mode: 'snapshot' })
    const docB = LoroDoc.fromSnapshot(snapshot)
    const managerB = getManager(docB)

    const docAUpdate = [
      { description: 'bb updated by A', name: 'aa', required: true, type: 'string' },
      { description: 'dd', name: 'cc', required: false, type: 'string' },
      { description: 'new from A', name: 'ee', required: false, type: 'number' },
    ]
    managerA.syncNodes([createParameterExtractorNode(deepClone(baseParameters))], [createParameterExtractorNode(deepClone(docAUpdate))])

    const docBUpdate = [
      { description: 'bb', name: 'aa', required: false, type: 'string' },
      { description: 'dd updated by B', name: 'cc', required: true, type: 'string' },
    ]
    managerB.syncNodes([createParameterExtractorNode(deepClone(baseParameters))], [createParameterExtractorNode(deepClone(docBUpdate))])

    const updateForA = docB.export({ mode: 'update', from: docA.version() })
    docA.import(updateForA)

    const updateForB = docA.export({ mode: 'update', from: docB.version() })
    docB.import(updateForB)

    const finalA = exportNodes(managerA).find(node => node.id === PARAM_NODE_ID)
    const finalB = exportNodes(managerB).find(node => node.id === PARAM_NODE_ID)

    expect(finalA).toBeDefined()
    expect(finalB).toBeDefined()

    const expectedParameters = [
      { description: 'bb updated by A', name: 'aa', required: true, type: 'string' },
      { description: 'dd updated by B', name: 'cc', required: true, type: 'string' },
      { description: 'new from A', name: 'ee', required: false, type: 'number' },
    ]

    expect((finalA!.data as any).parameters).toEqual(expectedParameters)
    expect((finalB!.data as any).parameters).toEqual(expectedParameters)
  })
})
