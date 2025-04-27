import type { InputVarType, MoreInfo, SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { TransferMethod } from '@/types/app'

export type FormData = {
  type: InputVarType
  label: string
  variable: string
  maxLength?: number
  default?: string | number
  required: boolean
  hint?: string
  options?: string[]
  placeholder?: string
  unit?: string
  allowedFileUploadMethods?: TransferMethod[]
  allowedTypesAndExtensions: {
    allowedFileTypes?: SupportUploadFileTypes[]
    allowedFileExtensions?: string[]
  }
}

export type InputFieldFormProps = {
  initialData: FormData
  supportFile?: boolean
  onCancel: () => void
  onSubmit: (value: FormData, moreInfo?: MoreInfo) => void
}

export type SchemaOptions = {
  maxFileUploadLimit: number
}
