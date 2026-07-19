import type { HumanInputNodeType } from '../types'
import useHumanInputFormContent from '../shared/use-form-content'

const useFormContent = (id: string, payload: HumanInputNodeType) =>
  useHumanInputFormContent(id, payload)

export default useFormContent
