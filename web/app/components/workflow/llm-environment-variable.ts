import type { LLMEnvironmentVariableValue } from '@/app/components/workflow/types'

export function isLLMEnvironmentVariableValue(
  value: unknown,
): value is LLMEnvironmentVariableValue {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<LLMEnvironmentVariableValue>
  return (
    typeof candidate.provider === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.mode === 'string'
  )
}
