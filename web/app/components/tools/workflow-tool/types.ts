import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderOutputSchema, WorkflowToolProviderParameter, WorkflowToolProviderRequest } from '../types'

export type WorkflowToolModalPayload = {
  icon: Emoji
  label: string
  name: string
  description: string
  parameters: WorkflowToolProviderParameter[]
  outputParameters: WorkflowToolProviderOutputParameter[]
  labels: string[]
  privacy_policy: string
  tool?: {
    output_schema?: WorkflowToolProviderOutputSchema
  }
  workflow_tool_id?: string
  workflow_app_id?: string
}

export type WorkflowToolModalProps = {
  isAdd?: boolean
  payload: WorkflowToolModalPayload
  onHide: () => void
  onRemove?: () => void
  onCreate?: (payload: WorkflowToolProviderRequest & { workflow_app_id: string }) => void
  onSave?: (payload: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => void
}
