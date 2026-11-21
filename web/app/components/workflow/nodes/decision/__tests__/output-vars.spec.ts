import type { DecisionNodeType } from '../types'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  getNodeOutputVars,
  toNodeOutputVars,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { DecideBy } from '../types'

const createPayload = (overrides: Partial<DecisionNodeType> = {}): DecisionNodeType => ({
  title: 'Decision',
  desc: '',
  type: BlockEnum.Decision,
  intent: '',
  decide_by: DecideBy.rules,
  outcomes: [
    { id: 'outcome-1', label: 'Refund', when: { logical_operator: 'and', conditions: [] } },
  ],
  otherwise: { label: '' },
  inputs: [],
  context: { glossary: '', prompt: '' },
  extras: [],
  ...overrides,
})

const decisionNode = (data: DecisionNodeType) =>
  createNode({ id: 'decision-1', data: { ...data, type: BlockEnum.Decision } })

describe('decision extras as output variables', () => {
  it('lists each named extra after the four fixed outputs', () => {
    const node = decisionNode(
      createPayload({
        extras: [
          { name: 'customer_note', from: 'model', hint: 'what the user wants' },
          { name: 'risk_level', from: 'fixed', values: { 'outcome-1': 'low' } },
        ],
      }),
    )

    const [decisionVars] = toNodeOutputVars([node], false, undefined, [], [], [], {})

    expect(decisionVars!.vars.map((variable) => variable.variable)).toEqual([
      'outcome',
      'outcome_id',
      'reason',
      'decided_by',
      'customer_note',
      'risk_level',
    ])
    expect(decisionVars!.vars.slice(4).every((variable) => variable.type === 'string')).toBe(true)
  })

  it('makes each named extra selectable by downstream nodes', () => {
    const node = decisionNode(
      createPayload({ extras: [{ name: 'customer_note', from: 'model', hint: '' }] }),
    )

    expect(getNodeOutputVars(node, false)).toEqual([
      ['decision-1', 'outcome'],
      ['decision-1', 'outcome_id'],
      ['decision-1', 'reason'],
      ['decision-1', 'decided_by'],
      ['decision-1', 'customer_note'],
    ])
  })

  it('ignores an extra whose name is still empty', () => {
    const node = decisionNode(createPayload({ extras: [{ name: '', from: 'fixed', values: {} }] }))

    expect(getNodeOutputVars(node, false)).toEqual([
      ['decision-1', 'outcome'],
      ['decision-1', 'outcome_id'],
      ['decision-1', 'reason'],
      ['decision-1', 'decided_by'],
    ])
  })
})
