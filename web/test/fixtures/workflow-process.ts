import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { HumanInputFormData } from '@/types/workflow'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

export const createWorkflowProcessFixture = (
  overrides: Partial<WorkflowProcess> = {},
): WorkflowProcess => ({
  status: WorkflowRunningStatus.Succeeded,
  tracing: [],
  ...overrides,
})

export const createHumanInputFormFixture = (
  overrides: Partial<HumanInputFormData> = {},
): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'human-input-1',
  node_title: 'Human Input',
  form_content: '',
  inputs: [],
  actions: [],
  form_token: 'token-1',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: null,
  ...overrides,
})
