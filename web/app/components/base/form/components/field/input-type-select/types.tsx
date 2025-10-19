import type { RemixiconComponentType } from '@remixicon/react'
import { z } from 'zod'

export const InputTypeEnum = z.enum([
  'text-input',
  'paragraph',
  'number',
  'select',
  'checkbox',
  'file',
  'file-list',
])

export type InputType = z.infer<typeof InputTypeEnum>

export type FileTypeSelectOption = {
  value: InputType
  label: string
  Icon: RemixiconComponentType
  type: string
}
