import type {
  HumanInputFilledFormData,
  HumanInputFormData,
  HumanInputFormTimeoutData,
} from '@/types/workflow'
import { enrichSubmittedHumanInputFormData } from './submitted-utils'

type HumanInputFormState = {
  humanInputFormDataList?: HumanInputFormData[]
  humanInputFilledFormDataList?: HumanInputFilledFormData[]
}

export const updatePendingHumanInputForm = (
  state: HumanInputFormState,
  data: HumanInputFormData,
) => {
  const forms = (state.humanInputFormDataList ??= [])
  const index = forms.findIndex((form) => form.form_id === data.form_id)
  if (index === -1) forms.push(data)
  else forms[index] = data
}

export const updateFilledHumanInputForm = (
  state: HumanInputFormState,
  data: HumanInputFilledFormData,
) => {
  const pendingForms = state.humanInputFormDataList
  const index = pendingForms?.findIndex((form) => form.form_id === data.form_id) ?? -1
  const pendingForm = index === -1 ? undefined : pendingForms?.splice(index, 1)[0]
  const filledForm = enrichSubmittedHumanInputFormData(data, pendingForm)
  const filledForms = (state.humanInputFilledFormDataList ??= [])
  const existingForm = filledForms.find((form) => form.form_id === data.form_id)
  if (existingForm) Object.assign(existingForm, filledForm)
  else filledForms.push(filledForm)
}

export const updateHumanInputFormTimeout = (
  state: HumanInputFormState,
  data: HumanInputFormTimeoutData,
) => {
  const form = state.humanInputFormDataList?.find((form) => form.form_id === data.form_id)
  if (form) form.expiration_time = data.expiration_time
}
