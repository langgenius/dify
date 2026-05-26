import type { ToolParameterShowOnCondition } from '@/app/components/tools/types'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'

/** Inner `{ type, value }` piece stored under ReasoningConfigEntry.value when auto === 0. */
export type ReasoningConfigInner = {
  type?: VarKindType
  value?: unknown
} | null

/** Params panel (`ReasoningConfigForm`) value shape per parameter key. */
export type ReasoningConfigEntry = {
  value: ReasoningConfigInner
  auto?: 0 | 1
}

export type ReasoningConfigValue = Record<string, ReasoningConfigEntry>

/** Loose equality between persisted sibling values and YAML string literals on show_on. */
export function valuesEqualForShowOn(stored: unknown, expected: string): boolean {
  if (stored === expected)
    return true
  if (typeof stored === 'boolean')
    return expected === String(stored)
  if (typeof stored === 'number' && !Number.isNaN(stored))
    return expected === String(stored)
  return false
}

/**
 * Resolve the scalar (or object) to compare against YAML `show_on.value` for settings / `ToolVarInputs`.
 * Unwraps an accidental extra `{ type, value }` wrapper around the payload.
 */
function toolSettingComparableValue(entry: ToolVarInputs[string]): unknown {
  let v = entry.value
  if (
    v !== null && typeof v === 'object' && !Array.isArray(v)
    && 'type' in v && 'value' in v
  ) {
    const inner = v as { type: string, value: unknown }
    if (inner.type === VarKindType.variable)
      return undefined
    v = inner.value
  }
  return v
}

export function toolSettingShowOnConditionMet(
  values: ToolVarInputs,
  condition: ToolParameterShowOnCondition,
): boolean {
  const sibling = values[condition.variable]
  if (!sibling)
    return false
  if (sibling.type === VarKindType.variable)
    return false
  const comparable = toolSettingComparableValue(sibling)
  return valuesEqualForShowOn(comparable, condition.value)
}

/** Settings form (`ToolForm`): AND semantics on sibling ToolVarInputs entries. */
export function isToolSettingShowOnSatisfied(
  conditions: ToolParameterShowOnCondition[] | undefined,
  values: ToolVarInputs,
): boolean {
  if (!conditions?.length)
    return true
  return conditions.every(cond => toolSettingShowOnConditionMet(values, cond))
}

export function reasoningShowOnConditionMet(
  values: ReasoningConfigValue,
  condition: ToolParameterShowOnCondition,
): boolean {
  const entry = values[condition.variable]
  if (!entry)
    return false
  if (entry.auto === 1)
    return false
  const inner = entry.value
  if (inner === null || inner === undefined)
    return false
  if (typeof inner !== 'object' || !('type' in inner))
    return false
  if (inner.type === VarKindType.variable)
    return false
  let comparable = inner.value
  if (
    comparable !== null && typeof comparable === 'object' && !Array.isArray(comparable)
    && 'type' in comparable && 'value' in comparable
  ) {
    const nested = comparable as { type: string, value: unknown }
    if (nested.type === VarKindType.variable)
      return false
    comparable = nested.value
  }
  return valuesEqualForShowOn(comparable, condition.value)
}

/** Params / reasoning form: AND semantics on sibling ReasoningConfigEntry values. */
export function isReasoningConfigShowOnSatisfied(
  conditions: ToolParameterShowOnCondition[] | undefined,
  values: ReasoningConfigValue,
): boolean {
  if (!conditions?.length)
    return true
  return conditions.every(cond => reasoningShowOnConditionMet(values, cond))
}
