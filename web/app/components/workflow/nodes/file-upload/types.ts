import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export type FileUploadNodeType = CommonNodeType & {
  variable_selector: ValueSelector
  is_array_file: boolean
}
