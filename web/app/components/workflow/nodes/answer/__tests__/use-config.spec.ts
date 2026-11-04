import type { AnswerNodeType } from '../types'
import { act } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import useConfig from '../use-config'

const createPayload = (overrides: Partial<AnswerNodeType> = {}): AnswerNodeType => ({
  title: 'Answer',
  desc: '',
  type: BlockEnum.Answer,
  variables: [],
  answer: 'Initial answer',
  ...overrides,
})

describe('answer/use-config', () => {
  it('preserves edited answer text while changing its variable bindings', () => {
    const { result } = renderNodeConfig(useConfig, createPayload())
    act(() => result.current.config.handleAnswerChange('Updated answer'))
    const variable = {
      variable: 'message',
      value_selector: ['start', 'message'],
      value_type: VarType.string,
    }
    act(() => result.current.config.handleVarListChange([variable]))
    act(() => result.current.config.handleAddVariable())
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      answer: 'Updated answer',
      variables: [variable, { variable: '', value_selector: [] }],
    })
  })
  it('excludes array objects from the answer variable picker', () => {
    const { result } = renderNodeConfig(useConfig, createPayload())
    expect(result.current.config.filterVar({ variable: 'items', type: VarType.arrayObject })).toBe(
      false,
    )
    expect(result.current.config.filterVar({ variable: 'message', type: VarType.string })).toBe(
      true,
    )
  })
})
