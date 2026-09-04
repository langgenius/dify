import type { LLMEnvironmentVariableValue } from '@/app/components/workflow/types'

const VALID_LLM_ENVIRONMENT_VARIABLE_MODES = new Set(['chat', 'completion'])

export function isLLMEnvironmentVariableValue(
  value: unknown,
): value is LLMEnvironmentVariableValue {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<LLMEnvironmentVariableValue>
  return (
    typeof candidate.provider === 'string' &&
    candidate.provider.trim().length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    typeof candidate.mode === 'string' &&
    VALID_LLM_ENVIRONMENT_VARIABLE_MODES.has(candidate.mode) &&
    (candidate.completion_params === undefined ||
      (typeof candidate.completion_params === 'object' &&
        candidate.completion_params !== null &&
        !Array.isArray(candidate.completion_params)))
  )
}
