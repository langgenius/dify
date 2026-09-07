import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import {
  applyHumanInputFilled,
  applyHumanInputRequired,
  applyHumanInputTimeout,
} from '../form-state'

const required = (form_id: string): HumanInputFormData => ({
  form_id,
  node_id: 'tool',
  node_title: 'Workflow Tool',
  form_content: `Approval ${form_id}`,
  inputs: [],
  actions: [],
  form_token: `token-${form_id}`,
  display_in_ui: true,
  expiration_time: 100,
  resolved_default_values: {},
})
const filled: HumanInputFilledFormData = {
  form_id: 'second',
  node_id: 'tool',
  node_title: 'Workflow Tool',
  rendered_content: 'Approved',
  action_id: 'approve',
  action_text: 'Approve',
}

it('updates only the addressed form when several forms share a Tool node', () => {
  const state: Parameters<typeof applyHumanInputRequired>[0] = {}
  const first = required('first')
  const second = required('second')
  applyHumanInputRequired(state, first)
  applyHumanInputRequired(state, second)
  applyHumanInputRequired(state, { ...second, form_token: 'refreshed' })
  applyHumanInputTimeout(state, { ...second, expiration_time: 200 })
  applyHumanInputTimeout(state, { ...required('missing'), expiration_time: 300 })

  expect(state.humanInputFormDataList).toEqual([
    first,
    { ...second, form_token: 'refreshed', expiration_time: 200 },
  ])

  applyHumanInputFilled(state, filled)
  applyHumanInputFilled(state, { ...filled, rendered_content: 'Replayed approval' })
  applyHumanInputTimeout(state, { ...second, expiration_time: 300 })

  expect(state.humanInputFormDataList).toEqual([first])
  expect(state.humanInputFilledFormDataList).toEqual([
    {
      ...filled,
      rendered_content: 'Replayed approval',
      form_content: second.form_content,
      inputs: [],
    },
  ])
  applyHumanInputFilled(state, { ...filled, form_id: 'first' })
  expect(state.humanInputFormDataList).toEqual([])
  expect(state.humanInputFilledFormDataList?.map((form) => form.form_id)).toEqual([
    'second',
    'first',
  ])
})

it('accepts submitted replay without a pending form and ignores its later timeout', () => {
  const state: Parameters<typeof applyHumanInputFilled>[0] = {}
  applyHumanInputFilled(state, filled)
  applyHumanInputFilled(state, filled)
  applyHumanInputTimeout(state, { ...filled, expiration_time: 200 })
  expect(state).toEqual({ humanInputFilledFormDataList: [filled] })
})
