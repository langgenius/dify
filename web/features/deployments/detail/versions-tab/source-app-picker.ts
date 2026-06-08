import type { SourceAppPickerValue } from '../../components/create-instance-modal'
import { isWorkflowAppMode } from '../../app-mode'

export function workflowSourceAppPickerValue(value: unknown, fallbackId: string): SourceAppPickerValue | undefined {
  if (!value || typeof value !== 'object')
    return undefined

  const record = value as Record<string, unknown>
  const mode = typeof record.mode === 'string' ? record.mode : undefined
  if (!isWorkflowAppMode(mode))
    return undefined

  const id = typeof record.id === 'string' && record.id ? record.id : fallbackId
  const name = typeof record.name === 'string' && record.name ? record.name : id

  return {
    id,
    name,
    mode,
  }
}
