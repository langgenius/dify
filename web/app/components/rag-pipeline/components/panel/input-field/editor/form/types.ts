import type { MoreInfo, SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { PipelineInputVarType } from '@/models/pipeline'
import type { TransferMethod } from '@/types/app'

export type FormData = {
  type: PipelineInputVarType
  label: string
  variable: string
  maxLength?: number
  default?: string
  required: boolean
  tooltips?: string
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
  initialData: Record<string, any>
  supportFile?: boolean
  onCancel: () => void
  onSubmit: (value: FormData, moreInfo?: MoreInfo) => void
  isEditMode?: boolean
}

export type SchemaOptions = {
  maxFileUploadLimit: number
}
