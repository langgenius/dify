import type { DecisionExtra } from '../types'
import { VarType } from '@/app/components/workflow/types'
import { ComparisonOperator } from '../../if-else/types'
import { DecideBy } from '../types'
import { getExtraNameError, hasExtraNameError, hasRulesToLose, toGeneratedDecision } from '../utils'

const extra = (overrides: Partial<DecisionExtra> = {}): DecisionExtra => ({
  name: 'note',
  from: 'fixed',
  values: {},
  hint: '',
  ...overrides,
})

describe('decision/utils extras name rules', () => {
  it('accepts a valid, unique, non-reserved name', () => {
    expect(getExtraNameError([extra()], 0)).toBeNull()
    expect(getExtraNameError([extra({ name: '_private_1' })], 0)).toBeNull()
  })

  it('requires a name', () => {
    expect(getExtraNameError([extra({ name: '' })], 0)).toBe('required')
    expect(getExtraNameError([extra({ name: '   ' })], 0)).toBe('required')
  })

  it('rejects names outside the identifier pattern', () => {
    expect(getExtraNameError([extra({ name: '1note' })], 0)).toBe('invalid')
    expect(getExtraNameError([extra({ name: 'has space' })], 0)).toBe('invalid')
    expect(getExtraNameError([extra({ name: 'a'.repeat(31) })], 0)).toBe('invalid')
  })

  it('rejects a name a built-in output already uses', () => {
    for (const name of ['outcome', 'outcome_id', 'reason', 'decided_by'])
      expect(getExtraNameError([extra({ name })], 0)).toBe('reserved')
  })

  it('rejects every entry that shares a name with another', () => {
    const extras = [extra({ name: 'note' }), extra({ name: 'note' })]
    expect(getExtraNameError(extras, 0)).toBe('duplicate')
    expect(getExtraNameError(extras, 1)).toBe('duplicate')
    expect(getExtraNameError([extra({ name: 'note' }), extra({ name: 'other' })], 0)).toBeNull()
  })

  it('reports whether any extra has a name error', () => {
    expect(hasExtraNameError([])).toBe(false)
    expect(hasExtraNameError(undefined)).toBe(false)
    expect(hasExtraNameError([extra()])).toBe(false)
    expect(hasExtraNameError([extra({ name: 'outcome' })])).toBe(true)
  })
})

describe('decision/utils generate preconditions', () => {
  it('treats a named outcome or a non-empty when as rules the user would lose', () => {
    expect(
      hasRulesToLose([{ id: 'a', label: '', when: { logical_operator: 'and', conditions: [] } }]),
    ).toBe(false)
    expect(
      hasRulesToLose([
        { id: 'a', label: 'Refund', when: { logical_operator: 'and', conditions: [] } },
      ]),
    ).toBe(true)
    expect(hasRulesToLose([{ id: 'a', label: '', when: 'wants money back' }])).toBe(true)
    expect(
      hasRulesToLose([
        {
          id: 'a',
          label: '',
          when: {
            logical_operator: 'and',
            conditions: [
              {
                id: 'c',
                varType: VarType.string,
                variable_selector: ['start', 'query'],
                comparison_operator: ComparisonOperator.contains,
                value: 'refund',
              },
            ],
          },
        },
      ]),
    ).toBe(true)
  })
})

describe('decision/utils toGeneratedDecision', () => {
  it('fills condition ids and variable types the wire response does not carry', () => {
    const generated = toGeneratedDecision(
      {
        decide_by: 'rules',
        outcomes: [
          {
            id: 'needs_approval',
            label: 'Needs approval',
            when: {
              logical_operator: 'and',
              conditions: [
                {
                  variable_selector: ['start', 'amount'],
                  comparison_operator: '>',
                  value: '500',
                },
                {
                  variable_selector: ['start', 'vip'],
                  comparison_operator: 'is',
                  value: true,
                },
              ],
            },
          },
        ],
        otherwise: { label: 'Escalate' },
        inputs: [],
        extras: [],
        error: '',
      },
      new Map([
        ['start.amount', VarType.number],
        ['start.vip', VarType.boolean],
      ]),
    )

    expect(generated.decide_by).toBe(DecideBy.rules)
    expect(generated.otherwise).toEqual({ label: 'Escalate' })
    const when = generated.outcomes[0]!.when
    expect(typeof when).toBe('object')
    if (typeof when !== 'object') throw new TypeError('expected a rule group')
    expect(when.logical_operator).toBe('and')
    expect(when.conditions[0]).toMatchObject({
      varType: VarType.number,
      variable_selector: ['start', 'amount'],
      comparison_operator: '>',
      value: '500',
    })
    // each condition gets its own id, as the If-Else editor does when adding one
    expect(when.conditions[0]!.id).toEqual(expect.any(String))
    expect(when.conditions[1]).toMatchObject({
      varType: VarType.boolean,
      variable_selector: ['start', 'vip'],
      comparison_operator: 'is',
      value: true,
    })
    expect(when.conditions[1]!.id).toEqual(expect.any(String))
    expect(when.conditions[0]!.id).not.toBe(when.conditions[1]!.id)
  })

  it('keeps a language-model description as a string and coerces extra values to strings', () => {
    const generated = toGeneratedDecision(
      {
        decide_by: 'llm',
        outcomes: [{ id: 'refund', label: 'Refund', when: 'the customer wants money back' }],
        otherwise: {},
        inputs: [{ variable: 'query', value_selector: ['start', 'query'] }],
        extras: [{ name: 'note', from: 'fixed', values: { refund: 42 } }],
        error: '',
      },
      new Map(),
    )

    expect(generated.decide_by).toBe(DecideBy.llm)
    expect(generated.outcomes[0]!.when).toBe('the customer wants money back')
    expect(generated.inputs).toEqual([{ variable: 'query', value_selector: ['start', 'query'] }])
    expect(generated.extras).toEqual([
      { name: 'note', from: 'fixed', values: { refund: '42' }, hint: '' },
    ])
  })
})
