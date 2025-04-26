import type { RemixiconComponentType } from '@remixicon/react'
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

export type FileTypeSelectOption = {
  value: string
  label: string
  Icon: RemixiconComponentType
  type: string
}
