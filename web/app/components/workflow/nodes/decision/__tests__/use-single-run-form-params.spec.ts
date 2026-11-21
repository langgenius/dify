import type { DecisionNodeType } from '../types'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { getInputVars as parseTemplateSelectors } from '@/app/components/base/prompt-editor/constants'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { DecideBy } from '../types'
import useSingleRunFormParams from '../use-single-run-form-params'

// boundary: the single-run hook supplies these converters; each form field
// follows its conventions: an explicit input keeps its alias, a template
// reference is keyed `#node.var#`.
const toField = (selector: ValueSelector): InputVar => ({
  label: selector.join('.'),
  variable: `#${selector.join('.')}#`,
  type: InputVarType.textInput,
  required: true,
})
const getInputVars = (textList: string[]) => textList.flatMap(parseTemplateSelectors).map(toField)
const varSelectorsToVarInputs = (selectors: ValueSelector[]) => selectors.map(toField)
const toVarInputs = (variables: Variable[]): InputVar[] =>
  variables.map((variable) => ({
    label: variable.variable,
    variable: variable.variable,
    type: InputVarType.textInput,
    required: true,
  }))

const createPayload = (overrides: Partial<DecisionNodeType> = {}): DecisionNodeType => ({
  title: 'Decision',
  desc: '',
  type: BlockEnum.Decision,
  intent: '',
  decide_by: DecideBy.llm,
  outcomes: [{ id: 'escalate', label: 'Escalate', when: 'Escalate for {{#code.priority#}}' }],
  otherwise: { label: '' },
  inputs: [{ variable: 'query', value_selector: ['start', 'query'] }],
  context: {
    glossary: 'VIP means {{#env.vip_rule#}}',
    prompt: 'Answer for {{#conversation.customer#}}',
  },
  extras: [],
  ...overrides,
})

const renderParams = (payload: DecisionNodeType) =>
  renderHook(() =>
    useSingleRunFormParams({
      id: 'decision',
      payload,
      runInputData: {},
      runInputDataRef: { current: {} },
      getInputVars,
      setRunInputData: vi.fn(),
      toVarInputs,
      varSelectorsToVarInputs,
    }),
  )

describe('decision/use-single-run-form-params', () => {
  it('asks for every variable a language-model decision reads, not only its inputs', () => {
    const { result } = renderParams(createPayload())

    // Keys match the backend mapping: `<node>.query` for an input,
    // `<node>.#code.priority#` for a template reference.
    expect(result.current.forms[0]!.inputs.map((input) => input.variable)).toEqual([
      'query',
      '#code.priority#',
      '#env.vip_rule#',
      '#conversation.customer#',
    ])
    // With no cached value for code.priority the run must open the form.
    expect(result.current.getDependentVars()).toEqual([
      ['start', 'query'],
      ['code', 'priority'],
      ['env', 'vip_rule'],
      ['conversation', 'customer'],
    ])
    expect(result.current.getDependentVar('query')).toEqual(['start', 'query'])
  })

  it('depends on variables referenced in rule values as well as compared variables', () => {
    const { result } = renderParams(
      createPayload({
        decide_by: DecideBy.rules,
        outcomes: [
          {
            id: 'over_limit',
            label: 'Over limit',
            when: {
              logical_operator: 'and',
              conditions: [
                {
                  id: 'c1',
                  varType: 'number',
                  variable_selector: ['start', 'amount'],
                  comparison_operator: '>',
                  value: '{{#code.limit#}}',
                },
              ],
            },
          },
        ],
      } as Partial<DecisionNodeType>),
    )

    expect(result.current.forms[0]!.inputs.map((input) => input.variable)).toEqual([
      '#start.amount#',
      '#code.limit#',
    ])
    expect(result.current.getDependentVars()).toEqual([
      ['start', 'amount'],
      ['code', 'limit'],
    ])
  })
})
