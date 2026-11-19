import type { DecisionNodeType } from '../types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import { ComparisonOperator } from '../../if-else/types'
import nodeDefault, { checkOutcomeRulesComplete } from '../default'
import { DecideBy, genDefaultRuleGroup } from '../types'

const t = withSelectorKey(
  vi.fn((key: string) => {
    if (key === 'nodes.decision.errorMsg.outcomeRequired') return 'outcome-required'
    if (key === 'nodes.decision.errorMsg.outcomeLabelRequired') return 'outcome-label-required'
    if (key === 'nodes.decision.errorMsg.conditionRequired') return 'condition-required'
    if (key === 'nodes.decision.errorMsg.modelRequired') return 'model-required'
    if (key === 'nodes.decision.errorMsg.whenRequired') return 'when-required'
    if (key === 'nodes.decision.errorMsg.inputRequired') return 'input-required'
    if (key === 'nodes.decision.errorMsg.extraNameInvalid') return 'extra-name-invalid'

    return key
  }),
  'workflow',
)

const completeCondition = {
  id: 'condition-1',
  varType: VarType.string,
  variable_selector: ['start', 'query'],
  comparison_operator: ComparisonOperator.contains,
  value: 'refund',
}

const createPayload = (overrides: Partial<DecisionNodeType> = {}): DecisionNodeType => ({
  title: 'Decision',
  desc: '',
  type: BlockEnum.Decision,
  intent: '',
  decide_by: DecideBy.rules,
  outcomes: [
    {
      id: 'outcome-1',
      label: 'Refund',
      when: {
        logical_operator: 'and',
        conditions: [completeCondition],
      },
    },
  ],
  otherwise: { label: '' },
  inputs: [],
  context: { glossary: '', prompt: '' },
  extras: [],
  ...overrides,
})

describe('decision/default', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rules mode', () => {
    it('accepts a complete rules payload', () => {
      const result = nodeDefault.checkValid(createPayload(), t)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })

    it('requires at least one outcome', () => {
      const result = nodeDefault.checkValid(createPayload({ outcomes: [] }), t)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('outcome-required')
    })

    it('requires every outcome to be named', () => {
      const result = nodeDefault.checkValid(
        createPayload({
          outcomes: [
            {
              id: 'outcome-1',
              label: '',
              when: { logical_operator: 'and', conditions: [completeCondition] },
            },
          ],
        }),
        t,
      )
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('outcome-label-required')
    })

    it('requires a complete condition per outcome, reusing the If-Else completeness check', () => {
      const result = nodeDefault.checkValid(
        createPayload({
          outcomes: [
            {
              id: 'outcome-1',
              label: 'Refund',
              when: genDefaultRuleGroup(),
            },
          ],
        }),
        t,
      )
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('condition-required')

      const incomplete = nodeDefault.checkValid(
        createPayload({
          outcomes: [
            {
              id: 'outcome-1',
              label: 'Refund',
              when: {
                logical_operator: 'and',
                // operator present but value missing
                conditions: [
                  {
                    id: 'condition-1',
                    varType: VarType.string,
                    variable_selector: ['start', 'query'],
                    comparison_operator: ComparisonOperator.contains,
                    value: '',
                  },
                ],
              },
            },
          ],
        }),
        t,
      )
      expect(incomplete.isValid).toBe(false)
      expect(incomplete.errorMessage).toBe('condition-required')

      // value-free operators need no value, like If-Else
      const valueFree = nodeDefault.checkValid(
        createPayload({
          outcomes: [
            {
              id: 'outcome-1',
              label: 'Refund',
              when: {
                logical_operator: 'and',
                conditions: [
                  {
                    id: 'condition-1',
                    varType: VarType.string,
                    variable_selector: ['start', 'query'],
                    comparison_operator: ComparisonOperator.empty,
                    value: '',
                  },
                ],
              },
            },
          ],
        }),
        t,
      )
      expect(valueFree.isValid).toBe(true)
    })

    it('checks sub-variable conditions recursively', () => {
      const withIncompleteSub = checkOutcomeRulesComplete({
        id: 'outcome-1',
        label: 'Refund',
        when: {
          logical_operator: 'and',
          conditions: [
            {
              id: 'condition-1',
              varType: VarType.object,
              variable_selector: ['node', 'file'],
              comparison_operator: ComparisonOperator.allOf,
              value: '',
              sub_variable_condition: {
                case_id: 'sub-case-1',
                logical_operator: 'and',
                conditions: [
                  {
                    id: 'sub-condition-1',
                    varType: VarType.string,
                    comparison_operator: ComparisonOperator.contains,
                    key: 'name',
                    value: '',
                  },
                ],
              },
            },
          ],
        },
      })
      expect(withIncompleteSub).toBe(false)
    })
  })

  describe('extra outputs', () => {
    it('accepts extras with unique, valid, non-reserved names', () => {
      const result = nodeDefault.checkValid(
        createPayload({
          extras: [
            { name: 'customer_note', from: 'model', hint: 'what the user wants' },
            { name: 'risk_level', from: 'fixed', values: { 'outcome-1': 'low' } },
          ],
        }),
        t,
      )
      expect(result.isValid).toBe(true)
    })

    it.each([
      ['empty', { name: '', from: 'fixed' as const }],
      ['malformed', { name: '1 note', from: 'fixed' as const }],
      ['reserved', { name: 'outcome', from: 'fixed' as const }],
      ['duplicated', { name: 'note', from: 'fixed' as const }],
    ])('rejects an extra name that is %s', (_label, extra) => {
      const result = nodeDefault.checkValid(
        createPayload({
          extras: [extra, { name: 'note', from: 'fixed' }],
        }),
        t,
      )
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('extra-name-invalid')
    })
  })

  describe('llm mode', () => {
    it('requires a model, non-empty when descriptions and one input', () => {
      const base = createPayload({
        decide_by: DecideBy.llm,
        outcomes: [
          {
            id: 'outcome-1',
            label: 'Refund',
            when: 'The customer asks for their money back',
          },
        ],
      })

      expect(nodeDefault.checkValid(base, t).isValid).toBe(false)

      const noModel = nodeDefault.checkValid(base, t)
      expect(noModel.errorMessage).toBe('model-required')

      const withModel = nodeDefault.checkValid(
        {
          ...base,
          model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
        },
        t,
      )
      expect(withModel.isValid).toBe(false)
      expect(withModel.errorMessage).toBe('input-required')

      const withInputs = nodeDefault.checkValid(
        {
          ...base,
          model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
          inputs: [{ variable: 'query', value_selector: ['start', 'query'] }],
        },
        t,
      )
      expect(withInputs.isValid).toBe(true)

      const emptyWhen = nodeDefault.checkValid(
        {
          ...base,
          model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
          inputs: [{ variable: 'query', value_selector: ['start', 'query'] }],
          outcomes: [{ id: 'outcome-1', label: 'Refund', when: '' }],
        },
        t,
      )
      expect(emptyWhen.isValid).toBe(false)
      expect(emptyWhen.errorMessage).toBe('when-required')
    })
  })
})
