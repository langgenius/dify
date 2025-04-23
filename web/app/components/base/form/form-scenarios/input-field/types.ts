import type { InputVar } from '@/app/components/workflow/types'
import type { RemixiconComponentType } from '@remixicon/react'
import type { TFunction } from 'i18next'
import { z } from 'zod'

export const InputType = z.enum([
  'text-input',
  'paragraph',
  'number',
  'select',
  'checkbox',
  'file',
  'file-list',
])

const TransferMethod = z.enum([
  'all',
  'local_file',
  'remote_url',
])

const SupportedFileTypes = z.enum([
  'image',
  'document',
  'video',
  'audio',
  'custom',
])

// TODO: Add validation rules
export const createInputFieldSchema = (t: TFunction) => z.object({
  type: InputType,
  label: z.string(),
  variable: z.string(),
  max_length: z.number().optional(),
  default: z.string().optional(),
  required: z.boolean(),
  hint: z.string().optional(),
  options: z.array(z.string()).optional(),
  allowed_file_upload_methods: z.array(TransferMethod),
  allowed_file_types: z.array(SupportedFileTypes),
  allowed_file_extensions: z.string().optional(),
})

export type InputFieldFormProps = {
  initialData?: InputVar
  supportFile?: boolean
  onCancel: () => void
  onSubmit: (value: InputVar) => void
}

export type TextFieldsProps = {
  initialData?: InputVar
}

export type FileTypeSelectOption = {
  value: string
  label: string
  Icon: RemixiconComponentType
  type: string
}
