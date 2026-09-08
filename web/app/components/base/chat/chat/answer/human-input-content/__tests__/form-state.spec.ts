import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import {
  updateFilledHumanInputForm,
  updateHumanInputFormTimeout,
  updatePendingHumanInputForm,
} from '../form-state'

const createPendingForm = (form_id: string): HumanInputFormData => ({
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
const filledForm: HumanInputFilledFormData = {
  form_id: 'second',
  node_id: 'tool',
  node_title: 'Workflow Tool',
  rendered_content: 'Approved',
  action_id: 'approve',
  action_text: 'Approve',
}

it('updates only the addressed form when several forms share a Tool node', () => {
  const state: Parameters<typeof updatePendingHumanInputForm>[0] = {}
  const first = createPendingForm('first')
  const second = createPendingForm('second')
  updatePendingHumanInputForm(state, first)
  updatePendingHumanInputForm(state, second)
  updatePendingHumanInputForm(state, { ...second, form_token: 'refreshed' })
  updateHumanInputFormTimeout(state, { ...second, expiration_time: 200 })
  updateHumanInputFormTimeout(state, { ...createPendingForm('missing'), expiration_time: 300 })

  expect(state.humanInputFormDataList).toEqual([
    first,
    { ...second, form_token: 'refreshed', expiration_time: 200 },
  ])

  updateFilledHumanInputForm(state, filledForm)
  updateFilledHumanInputForm(state, { ...filledForm, rendered_content: 'Replayed approval' })
  updateHumanInputFormTimeout(state, { ...second, expiration_time: 300 })

  expect(state.humanInputFormDataList).toEqual([first])
  expect(state.humanInputFilledFormDataList).toEqual([
    {
      ...filledForm,
      rendered_content: 'Replayed approval',
      form_content: second.form_content,
      inputs: [],
    },
  ])
  updateFilledHumanInputForm(state, { ...filledForm, form_id: 'first' })
  expect(state.humanInputFormDataList).toEqual([])
  expect(state.humanInputFilledFormDataList?.map((form) => form.form_id)).toEqual([
    'second',
    'first',
  ])
})

it('accepts submitted replay without a pending form and ignores its later timeout', () => {
  const state: Parameters<typeof updateFilledHumanInputForm>[0] = {}
  updateFilledHumanInputForm(state, filledForm)
  updateFilledHumanInputForm(state, filledForm)
  updateHumanInputFormTimeout(state, { ...filledForm, expiration_time: 200 })
  expect(state).toEqual({ humanInputFilledFormDataList: [filledForm] })
})
