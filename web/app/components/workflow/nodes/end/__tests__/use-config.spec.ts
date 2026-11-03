import type { EndNodeType } from '../types'
import { act } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import useConfig from '../use-config'

const createPayload = (overrides: Partial<EndNodeType> = {}): EndNodeType => ({
  title: 'End',
  desc: '',
  type: BlockEnum.End,
  outputs: [],
  ...overrides,
})

describe('end/use-config', () => {
  it('adds output bindings without losing existing outputs', () => {
    const { result } = renderNodeConfig(useConfig, createPayload())
    const output = {
      variable: 'result',
      value_selector: ['source', 'text'],
      value_type: VarType.string,
    }
    act(() => result.current.config.handleVarListChange([output]))
    act(() => result.current.config.handleAddVariable())
    expect(result.current.flow.getNode('node')?.data.outputs).toEqual([
      output,
      { variable: '', value_selector: [] },
    ])
  })
})
