import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'

export const enrichSubmittedHumanInputFormData = (
  filledFormData: HumanInputFilledFormData,
  requiredFormData?: Pick<HumanInputFormData, 'form_content' | 'inputs'>,
): HumanInputFilledFormData => {
  if (!requiredFormData)
    return filledFormData

  return {
    ...filledFormData,
    form_content: requiredFormData.form_content,
    inputs: requiredFormData.inputs,
  }
}
