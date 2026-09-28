import type { EnvironmentVariable } from '@/app/components/workflow/types'

const editableValueTypes = new Set(['string', 'number', 'secret', 'llm'])

export const isEditableEnvironmentVariable = (env: EnvironmentVariable) =>
  editableValueTypes.has(env.value_type)
