import type { VarInInspect } from '@/types/workflow'
import { createStore } from 'zustand/vanilla'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'
import { createInspectVarsSlice } from '../inspect-vars-slice'

const createInspectVar = (overrides?: Partial<VarInInspect>): VarInInspect => ({
  id: 'var-1',
  type: VarInInspectType.node,
  name: 'answer',
  description: 'Inspect variable',
  selector: ['node-1', 'answer'],
  value_type: VarType.string,
  value: 'initial',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 7,
    download_url: 'https://example.com/inspect-var.txt',
  },
  ...overrides,
})

describe('createInspectVarsSlice', () => {
  it('updates focus state and replaces node inspect variables', () => {
    const store = createStore(createInspectVarsSlice)
    const vars = [createInspectVar()]

    store.getState().setCurrentFocusNodeId('node-1')
    store.getState().setNodesWithInspectVars([
      {
        nodeId: 'node-1',
        nodePayload: { type: BlockEnum.Start, title: 'Start', desc: '' } as never,
        nodeType: BlockEnum.Start,
        title: 'Start',
        vars: [],
      },
    ])
    store.getState().setNodeInspectVars('node-1', vars)

    expect(store.getState().currentFocusNodeId).toBe('node-1')
    expect(store.getState().nodesWithInspectVars[0]).toMatchObject({
      nodeId: 'node-1',
      isValueFetched: true,
      vars,
    })
  })

  it('edits, renames, resets, and deletes inspect vars', () => {
    const store = createStore(createInspectVarsSlice)

    store.getState().setNodesWithInspectVars([
      {
        nodeId: 'node-1',
        nodePayload: { type: BlockEnum.Start, title: 'Start', desc: '' } as never,
        nodeType: BlockEnum.Start,
        title: 'Start',
        vars: [createInspectVar()],
      },
    ])

    store.getState().setInspectVarValue('node-1', 'var-1', 'edited')
    expect(store.getState().nodesWithInspectVars[0]!.vars[0]).toMatchObject({
      value: 'edited',
      edited: true,
    })

    store.getState().renameInspectVarName('node-1', 'var-1', ['node-1', 'renamed'])
    expect(store.getState().nodesWithInspectVars[0]!.vars[0]).toMatchObject({
      name: 'renamed',
      selector: ['node-1', 'renamed'],
    })

    store.getState().resetToLastRunVar('node-1', 'var-1', 'restored')
    expect(store.getState().nodesWithInspectVars[0]!.vars[0]).toMatchObject({
      value: 'restored',
      edited: false,
    })

    store.getState().deleteInspectVar('node-1', 'var-1')
    expect(store.getState().nodesWithInspectVars[0]!.vars).toEqual([])

    store.getState().deleteNodeInspectVars('node-1')
    expect(store.getState().nodesWithInspectVars).toEqual([])

    store.getState().setNodesWithInspectVars([
      {
        nodeId: 'node-2',
        nodePayload: { type: BlockEnum.Start, title: 'Start', desc: '' } as never,
        nodeType: BlockEnum.Start,
        title: 'Start',
        vars: [createInspectVar({ id: 'var-2' })],
      },
    ])
    store.getState().deleteAllInspectVars()

    expect(store.getState().nodesWithInspectVars).toEqual([])
  })
})
