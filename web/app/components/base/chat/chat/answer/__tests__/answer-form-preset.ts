import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'

export const pendingForm: HumanInputFormData = {
  form_id: 'form-1',
  node_id: 'review',
  node_title: 'Review request',
  form_content: 'Please approve this response.',
  inputs: [],
  actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  form_token: 'form-token',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: null,
}

export const filledForm: HumanInputFilledFormData = {
  form_id: 'form-1',
  node_id: 'review',
  node_title: 'Completed review',
  rendered_content: 'Approved response',
  action_id: 'approve',
  action_text: 'Approved',
}
