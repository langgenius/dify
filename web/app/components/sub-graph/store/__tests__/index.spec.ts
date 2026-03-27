import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
import { createSubGraphSlice } from '../index'

describe('createSubGraphSlice', () => {
  it('should initialize and update parent availability state', () => {
    let state = {} as ReturnType<typeof createSubGraphSlice>
    const set = (updater: (current: ReturnType<typeof createSubGraphSlice>) => Partial<ReturnType<typeof createSubGraphSlice>>) => {
      state = {
        ...state,
        ...updater(state),
      }
    }

    state = createSubGraphSlice(set as never, (() => state) as never, {} as never)

    expect(state.parentAvailableVars).toEqual([])
    expect(state.parentAvailableNodes).toEqual([])

    const parentAvailableVars: NodeOutPutVar[] = [{ nodeId: 'node-1', title: 'Node 1', vars: [] }]
    state.setParentAvailableVars(parentAvailableVars)
    expect(state.parentAvailableVars).toEqual(parentAvailableVars)

    const parentAvailableNodes = [{ id: 'node-1' }] as Node[]
    state.setParentAvailableNodes(parentAvailableNodes)
    expect(state.parentAvailableNodes).toEqual(parentAvailableNodes)
  })
})
