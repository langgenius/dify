import type { Condition } from '../if-else/types'
import type { CommonNodeType, ModelConfig, Variable } from '@/app/components/workflow/types'

export const DecideBy = {
  rules: 'rules',
  llm: 'llm',
  decisionModel: 'decision_model',
} as const

export type DecideBy = (typeof DecideBy)[keyof typeof DecideBy]

// Reuse the If-Else node's condition shape verbatim so the If-Else condition
// editor can operate on decision rule groups without a conversion layer.
export type RuleGroup = {
  logical_operator: 'and' | 'or'
  conditions: Condition[]
}

export type Outcome = {
  id: string
  label: string
  when: string | RuleGroup
}

export const OTHERWISE_HANDLE_ID = 'otherwise'

export type ExtraSource = 'fixed' | 'model'

// An extra output field: either a fixed value per outcome, or a field the
// deciding model writes. Mirrors the backend `DecisionExtra` entity.
export type DecisionExtra = {
  name: string
  from: ExtraSource
  values?: Record<string, string>
  hint?: string
}

export type DecisionNodeType = CommonNodeType & {
  intent: string
  decide_by: DecideBy
  outcomes: Outcome[]
  otherwise: { label: string }
  inputs: Variable[]
  model?: ModelConfig
  context: {
    glossary: string
    prompt: string
  }
  extras: DecisionExtra[]
}

export const genOutcomeId = () =>
  `outcome_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const genDefaultRuleGroup = (): RuleGroup => ({
  logical_operator: 'and',
  conditions: [],
})
