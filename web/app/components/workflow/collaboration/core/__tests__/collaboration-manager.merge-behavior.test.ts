import { LoroDoc } from 'loro-crdt'
import { CollaborationManager } from '../collaboration-manager'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

const NODE_ID = 'node-1'

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

const getManager = (doc: LoroDoc) => {
  const manager = new CollaborationManager()
  ;(manager as any).doc = doc
  ;(manager as any).nodesMap = doc.getMap('nodes')
  ;(manager as any).edgesMap = doc.getMap('edges')
  return manager
}

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
})
