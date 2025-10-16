import { LoroDoc } from 'loro-crdt'
import { CollaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { BlockEnum } from '@/app/components/workflow/types'
import type { Node } from '@/app/components/workflow/types'

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

const getVariables = (node: Node): string[] => {
  const variables = (node.data as any)?.variables ?? []
  return variables.map((item: WorkflowVariable) => item.variable)
}

const getVariableObject = (node: Node, name: string): WorkflowVariable | undefined => {
  const variables = (node.data as any)?.variables ?? []
  return variables.find((item: WorkflowVariable) => item.variable === name)
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
})
