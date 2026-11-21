import type {
  DecisionGenerateOutcomeResponse,
  DecisionGenerateResponse,
} from '@dify/contracts/api/console/decision-generate/types.gen'
import type { NodeOutPutVar } from '../../types'
import type { ComparisonOperator, Condition } from '../if-else/types'
import type { DecisionExtra, DecisionNodeType, Outcome, RuleGroup } from './types'
import { v4 as uuid4 } from 'uuid'
import { VarType } from '../../types'
import { resolveValueSelector } from '../_base/components/variable/var-reference-vars.helpers'
import { genDefaultRuleGroup } from './types'

// Mirrors the backend `DecisionExtra.name` contract: a Python-style identifier
// that later nodes can address as a variable.
const EXTRA_NAME_PATTERN = /^[a-z_]\w{0,29}$/i

// Output keys the node always writes; an extra may not reuse one.
const RESERVED_EXTRA_NAMES: readonly string[] = ['outcome', 'outcome_id', 'reason', 'decided_by']

export type ExtraNameError = 'required' | 'invalid' | 'duplicate' | 'reserved'

export const getExtraNameError = (
  extras: DecisionExtra[],
  index: number,
): ExtraNameError | null => {
  const name = extras[index]?.name ?? ''
  if (!name.trim()) return 'required'
  if (!EXTRA_NAME_PATTERN.test(name)) return 'invalid'
  if (RESERVED_EXTRA_NAMES.includes(name)) return 'reserved'
  if (extras.some((extra, otherIndex) => otherIndex !== index && extra.name === name))
    return 'duplicate'

  return null
}

export const hasExtraNameError = (extras: DecisionExtra[] | undefined) =>
  !!extras?.some((_, index) => getExtraNameError(extras, index) !== null)

// A generated rule group carries no condition ids or variable types: the
// generator only knows selectors and operators. Fill both in from the
// variables this node can read, so the If-Else condition editor can edit the
// result without a conversion layer.
const toRuleGroup = (
  when: DecisionGenerateOutcomeResponse['when'],
  varTypesBySelector: Map<string, VarType>,
): RuleGroup => {
  if (typeof when !== 'object' || when === null) return genDefaultRuleGroup()

  return {
    logical_operator: when.logical_operator === 'or' ? 'or' : 'and',
    conditions: (when.conditions ?? []).map((condition): Condition => {
      const selector = condition.variable_selector
      return {
        id: uuid4(),
        varType: varTypesBySelector.get(selector.join('.')) ?? VarType.string,
        variable_selector: selector,
        comparison_operator: condition.comparison_operator as ComparisonOperator,
        value: condition.value ?? '',
      }
    }),
  }
}

const toOutcome = (
  outcome: DecisionGenerateOutcomeResponse,
  varTypesBySelector: Map<string, VarType>,
): Outcome => ({
  id: outcome.id,
  label: outcome.label ?? '',
  when:
    typeof outcome.when === 'string' ? outcome.when : toRuleGroup(outcome.when, varTypesBySelector),
})

const toExtra = (raw: Record<string, unknown>): DecisionExtra => {
  const values = raw.values
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    from: raw.from === 'model' ? 'model' : 'fixed',
    values:
      values && typeof values === 'object' && !Array.isArray(values)
        ? Object.fromEntries(
            Object.entries(values as Record<string, unknown>).map(([key, value]) => [
              key,
              value == null ? '' : String(value),
            ]),
          )
        : {},
    hint: typeof raw.hint === 'string' ? raw.hint : '',
  }
}

type GeneratedDecision = Pick<
  DecisionNodeType,
  'decide_by' | 'outcomes' | 'otherwise' | 'inputs' | 'extras'
>

// Turn the generator's wire response into node data. `varTypesBySelector` maps
// a flattened selector (`nodeId.variable`) to the workflow type the node can
// read, which the response does not carry.
export const toGeneratedDecision = (
  result: DecisionGenerateResponse,
  varTypesBySelector: Map<string, VarType>,
): GeneratedDecision => ({
  decide_by: result.decide_by === 'llm' ? 'llm' : 'rules',
  outcomes: (result.outcomes ?? []).map((outcome) => toOutcome(outcome, varTypesBySelector)),
  otherwise: { label: result.otherwise?.label ?? '' },
  inputs: (result.inputs ?? []).map((input) => ({
    variable: input.variable,
    value_selector: input.value_selector,
  })),
  extras: (result.extras ?? []).map(toExtra),
})

// The node already holds rules the user would lose: any outcome is named, or
// carries a non-empty `when` in either authoring shape.
export const hasRulesToLose = (outcomes: Outcome[]) =>
  outcomes.some((outcome) => {
    if (outcome.label) return true
    if (typeof outcome.when === 'string') return outcome.when.trim() !== ''
    return !!outcome.when && outcome.when.conditions.length > 0
  })

// Flattened view of the variables this node can read, in the shape the
// generator expects, capped at `limit` entries. Each selector is the one the
// variable picker would write (`sys.query` becomes `['sys', 'query']`, a node
// output `['node', 'name']`), so a generated rule reads a variable that exists.
// The map keeps the workflow type of each selector (joined with `.`) so a
// generated condition can carry the `varType` the condition editor needs.
export const toGeneratorVariables = (availableVars: NodeOutPutVar[], limit: number) => {
  const types = new Map<string, VarType>()
  const variables = availableVars
    .flatMap((nodeVars) =>
      nodeVars.vars.flatMap((variable) => {
        const valueSelector = resolveValueSelector({
          itemData: variable,
          isFlat: nodeVars.isFlat,
          isSupportFileVar: true,
          nodeId: nodeVars.nodeId,
          objPath: [],
        })
        if (!valueSelector) return []
        return [
          {
            value_selector: valueSelector,
            type: variable.type,
            description: variable.des ?? '',
          },
        ]
      }),
    )
    .slice(0, limit)
  variables.forEach((variable) => types.set(variable.value_selector.join('.'), variable.type))
  return { availableVariables: variables, varTypesBySelector: types }
}
