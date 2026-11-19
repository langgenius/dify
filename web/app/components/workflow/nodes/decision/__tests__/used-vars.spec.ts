import type { Condition } from '../../if-else/types'
import type { DecisionNodeType, Outcome, RuleGroup } from '../types'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  getNodeUsedVars,
  updateNodeVars,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum } from '@/app/components/workflow/types'

// The Decision cases of the shared used-variable collection and rename
// propagation: a rule condition's right-hand value can embed `{{#node.var#}}`
// templates, in the main rule group and in sub-variable conditions.
const createDecisionNode = (overrides: Partial<DecisionNodeType> = {}) =>
  createNode({
    id: 'node',
    data: {
      title: 'Decision',
      desc: '',
      type: BlockEnum.Decision,
      intent: '',
      decide_by: 'rules',
      outcomes: [],
      otherwise: { label: '' },
      inputs: [],
      context: { glossary: '', prompt: '' },
      extras: [],
      ...overrides,
    } as DecisionNodeType,
  })

const ruleGroupOutcome = (value: Condition['value']): Outcome => ({
  id: 'outcome-1',
  label: 'Refund',
  when: {
    logical_operator: 'and' as const,
    conditions: [
      {
        id: 'condition-1',
        varType: 'string' as const,
        variable_selector: ['start', 'query'],
        comparison_operator: 'contains' as const,
        value,
      },
      {
        id: 'condition-2',
        varType: 'object' as const,
        variable_selector: ['start', 'customer'],
        comparison_operator: undefined,
        value: '',
        sub_variable_condition: {
          case_id: 'sub-case',
          logical_operator: 'and' as const,
          conditions: [
            {
              id: 'sub-condition-1',
              varType: 'string' as const,
              key: 'tier',
              comparison_operator: 'is' as const,
              value,
            },
          ],
        },
      },
    ],
  },
})

describe('decision used-variable collection and rename', () => {
  it('collects templates embedded in condition values, including sub-variable ones', () => {
    const node = createDecisionNode({
      outcomes: [ruleGroupOutcome('{{#code.threshold#}}')],
    })

    expect(getNodeUsedVars(node)).toEqual(
      expect.arrayContaining([
        ['start', 'query'],
        ['start', 'customer'],
        ['code', 'threshold'],
      ]),
    )
  })

  it('collects templates from every entry of a list-valued condition', () => {
    const node = createDecisionNode({
      outcomes: [ruleGroupOutcome(['keep', '{{#code.threshold#}}'])],
    })

    expect(getNodeUsedVars(node)).toContainEqual(['code', 'threshold'])
  })

  it('renames templates embedded in condition values, including sub-variable ones', () => {
    const node = createDecisionNode({
      outcomes: [ruleGroupOutcome('over {{#code.threshold#}}')],
    })

    const renamed = updateNodeVars(node, ['code', 'threshold'], ['code', 'limit'])
    const outcome = (renamed.data as DecisionNodeType).outcomes[0]!
    const conditions = (outcome.when as RuleGroup).conditions

    expect(conditions[0]!.value).toBe('over {{#code.limit#}}')
    expect(conditions[1]!.sub_variable_condition!.conditions[0]!.value).toBe(
      'over {{#code.limit#}}',
    )
    // the left-hand selectors are renamed as before
    expect(conditions[0]!.variable_selector).toEqual(['start', 'query'])
  })

  it('leaves a value that references nothing untouched', () => {
    const node = createDecisionNode({
      outcomes: [ruleGroupOutcome('over 500')],
    })

    const renamed = updateNodeVars(node, ['code', 'threshold'], ['code', 'limit'])
    const outcome = (renamed.data as DecisionNodeType).outcomes[0]!
    const conditions = (outcome.when as RuleGroup).conditions

    expect(conditions[0]!.value).toBe('over 500')
    expect(conditions[1]!.sub_variable_condition!.conditions[0]!.value).toBe('over 500')
  })
})
