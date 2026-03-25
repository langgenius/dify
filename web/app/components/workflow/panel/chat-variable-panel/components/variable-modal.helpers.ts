import type { ReactNode } from 'react'
import type { ChatVarType } from '../type'
import type { ConversationVariable, JsonValue } from '@/app/components/workflow/types'
import { checkKeys } from '@/utils/var'
import { ChatVarType as ChatVarTypeEnum } from '../type'
import {
  arrayBoolPlaceholder,
  arrayNumberPlaceholder,
  arrayObjectPlaceholder,
  arrayStringPlaceholder,
  objectPlaceholder,
} from '../utils'
import { DEFAULT_OBJECT_VALUE } from './object-value-item'

export type ObjectValueItem = {
  key: string
  type: ChatVarType
  value: string | number | undefined
}

export type ToastPayload = {
  type?: 'success' | 'error' | 'warning' | 'info'
  size?: 'md' | 'sm'
  duration?: number
  message: string
  children?: ReactNode
  onClose?: () => void
  className?: string
  customComponent?: ReactNode
}

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null)
    return true

  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean')
    return true

  if (Array.isArray(value))
    return value.every(item => isJsonValue(item))

  if (valueType === 'object') {
    if (!value)
      return false

    return Object.values(value).every(item => isJsonValue(item))
  }

  return false
}

const isJsonRecord = (value: JsonValue): value is Record<string, JsonValue> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export const typeList = [
  ChatVarTypeEnum.String,
  ChatVarTypeEnum.Number,
  ChatVarTypeEnum.Boolean,
  ChatVarTypeEnum.Object,
  ChatVarTypeEnum.ArrayString,
  ChatVarTypeEnum.ArrayNumber,
  ChatVarTypeEnum.ArrayBoolean,
  ChatVarTypeEnum.ArrayObject,
]

export const getEditorMinHeight = (type: ChatVarType) =>
  type === ChatVarTypeEnum.ArrayObject ? '240px' : '120px'

export const getPlaceholderByType = (type: ChatVarType) => {
  if (type === ChatVarTypeEnum.ArrayString)
    return arrayStringPlaceholder
  if (type === ChatVarTypeEnum.ArrayNumber)
    return arrayNumberPlaceholder
  if (type === ChatVarTypeEnum.ArrayObject)
    return arrayObjectPlaceholder
  if (type === ChatVarTypeEnum.ArrayBoolean)
    return arrayBoolPlaceholder
  return objectPlaceholder
}

export const buildObjectValueItems = (chatVar?: ConversationVariable): ObjectValueItem[] => {
  if (!chatVar)
    return [DEFAULT_OBJECT_VALUE]

  const value = chatVar.value
  if (!isJsonRecord(value) || Object.keys(value).length === 0)
    return [DEFAULT_OBJECT_VALUE]

  return Object.keys(value).map((key) => {
    const itemValue = value[key]
    return {
      key,
      type: typeof itemValue === 'string' ? ChatVarTypeEnum.String : ChatVarTypeEnum.Number,
      value: typeof itemValue === 'string' || typeof itemValue === 'number' ? itemValue : undefined,
    }
  })
}

export const formatObjectValueFromList = (list: ObjectValueItem[]) => {
  return list.reduce<Record<string, JsonValue>>((acc, curr) => {
    if (curr.key)
      acc[curr.key] = curr.value === undefined || curr.value === '' ? null : curr.value
    return acc
  }, {})
}

export const formatChatVariableValue = ({
  editInJSON,
  objectValue,
  type,
  value,
}: {
  editInJSON: boolean
  objectValue: ObjectValueItem[]
  type: ChatVarType
  value: unknown
}): JsonValue => {
  switch (type) {
    case ChatVarTypeEnum.String:
      return typeof value === 'string' ? value : ''
    case ChatVarTypeEnum.Number:
      return typeof value === 'number' && !Number.isNaN(value) ? value : 0
    case ChatVarTypeEnum.Boolean:
      return typeof value === 'boolean' ? value : false
    case ChatVarTypeEnum.Object:
      return editInJSON && isJsonValue(value) ? value : formatObjectValueFromList(objectValue)
    case ChatVarTypeEnum.ArrayString:
    case ChatVarTypeEnum.ArrayNumber:
    case ChatVarTypeEnum.ArrayObject:
      return Array.isArray(value) ? value.filter((item): item is JsonValue => item !== undefined) : []
    case ChatVarTypeEnum.ArrayBoolean:
      return Array.isArray(value) ? value.filter((item): item is JsonValue => item !== undefined) : []
  }
}

export const validateVariableName = ({
  name,
  notify,
  t,
}: {
  name: string
  notify: (props: ToastPayload) => void
  t: (key: string, options?: Record<string, unknown>) => string
}) => {
  const { isValid, errorMessageKey } = checkKeys([name], false)
  if (!isValid) {
    notify({
      type: 'error',
      message: t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: t('env.modal.name', { ns: 'workflow' }) }),
    })
    return false
  }
  return true
}

export const getTypeChangeState = (nextType: ChatVarType) => {
  return {
    editInJSON: nextType === ChatVarTypeEnum.ArrayObject,
    editorContent: undefined as string | undefined,
    objectValue: nextType === ChatVarTypeEnum.Object ? [DEFAULT_OBJECT_VALUE] : undefined,
    value:
      nextType === ChatVarTypeEnum.Boolean
        ? false
        : nextType === ChatVarTypeEnum.ArrayBoolean
          ? [false]
          : undefined,
  }
}

export const parseEditorContent = ({
  content,
  type,
}: {
  content: string
  type: ChatVarType
}): JsonValue => {
  const parsed: unknown = JSON.parse(content)
  if (type !== ChatVarTypeEnum.ArrayBoolean) {
    if (!isJsonValue(parsed))
      throw new Error('Invalid JSON')
    return parsed
  }

  if (!Array.isArray(parsed))
    throw new Error('Invalid JSON array')

  return parsed
    .map((item: string | boolean) => {
      if (item === 'True' || item === 'true' || item === true)
        return true
      if (item === 'False' || item === 'false' || item === false)
        return false
      return undefined
    })
    .filter((item?: boolean) => item !== undefined)
}

export const getEditorToggleLabelKey = (type: ChatVarType, editInJSON: boolean) => {
  if (type === ChatVarTypeEnum.Object)
    return editInJSON ? 'chatVariable.modal.editInForm' : 'chatVariable.modal.editInJSON'

  return editInJSON ? 'chatVariable.modal.oneByOne' : 'chatVariable.modal.editInJSON'
}
