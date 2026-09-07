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

export const applyHumanInputRequired = (state: HumanInputFormState, data: HumanInputFormData) => {
  const forms = (state.humanInputFormDataList ??= [])
  const index = forms.findIndex((form) => form.form_id === data.form_id)
  if (index === -1) forms.push(data)
  else forms[index] = data
}

export const applyHumanInputFilled = (
  state: HumanInputFormState,
  data: HumanInputFilledFormData,
) => {
  const pending = state.humanInputFormDataList
  const index = pending?.findIndex((form) => form.form_id === data.form_id) ?? -1
  const required = index === -1 ? undefined : pending?.splice(index, 1)[0]
  const enriched = enrichSubmittedHumanInputFormData(data, required)
  const filled = (state.humanInputFilledFormDataList ??= [])
  const existing = filled.find((form) => form.form_id === data.form_id)
  if (existing) Object.assign(existing, enriched)
  else filled.push(enriched)
}

export const applyHumanInputTimeout = (
  state: HumanInputFormState,
  data: HumanInputFormTimeoutData,
) => {
  const form = state.humanInputFormDataList?.find((form) => form.form_id === data.form_id)
  if (form) form.expiration_time = data.expiration_time
}
