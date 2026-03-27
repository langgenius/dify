'use client'

import type { InputVar } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { InputVarType } from '@/app/components/workflow/types'

export const TEXT_MAX_LENGTH = 256
export const CHECKBOX_DEFAULT_TRUE_VALUE = 'true'
export const CHECKBOX_DEFAULT_FALSE_VALUE = 'false'
export const FILE_INPUT_TYPES = [InputVarType.singleFile, InputVarType.multiFiles] as const

export const getCheckboxDefaultSelectValue = (value: InputVar['default'] | boolean) => {
  if (typeof value === 'boolean')
    return value ? CHECKBOX_DEFAULT_TRUE_VALUE : CHECKBOX_DEFAULT_FALSE_VALUE

  if (typeof value === 'string')
    return value.toLowerCase() === CHECKBOX_DEFAULT_TRUE_VALUE ? CHECKBOX_DEFAULT_TRUE_VALUE : CHECKBOX_DEFAULT_FALSE_VALUE

  return CHECKBOX_DEFAULT_FALSE_VALUE
}

export const parseCheckboxSelectValue = (value: string) => value === CHECKBOX_DEFAULT_TRUE_VALUE

export const normalizeSelectDefaultValue = (inputVar: InputVar) => {
  if (inputVar.type === InputVarType.select && inputVar.default === '')
    return { ...inputVar, default: undefined }

  return inputVar
}

export const isJsonSchemaEmpty = (value: InputVar['json_schema']) => {
  if (value === null || value === undefined)
    return true

  if (typeof value !== 'string')
    return false

  return value.trim() === ''
}

export const applyTypeChange = (payload: InputVar, type: InputVarType) => {
  return produce(payload, (draft) => {
    draft.type = type

    if (type === InputVarType.select)
      draft.default = undefined

    if (FILE_INPUT_TYPES.includes(type as typeof FILE_INPUT_TYPES[number])) {
      Object.entries(DEFAULT_FILE_UPLOAD_SETTING).forEach(([key, value]) => {
        if (key !== 'max_length')
          Reflect.set(draft, key, value)
      })

      if (type === InputVarType.multiFiles)
        draft.max_length = DEFAULT_FILE_UPLOAD_SETTING.max_length
    }
  })
}
