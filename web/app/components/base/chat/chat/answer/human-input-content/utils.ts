import type { HumanInputFieldValue } from './field-renderer'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Locale } from '@/i18n-config'
import type { HumanInputResolvedValue } from '@/types/workflow'
import dayjs from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import relativeTime from 'dayjs/plugin/relativeTime'
import utc from 'dayjs/plugin/utc'
import { fileIsUploaded, getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import {
  isFileFormInput,
  isFileListFormInput,
  isParagraphFormInput,
  isSelectFormInput,
  UserActionButtonType,
} from '@/app/components/workflow/nodes/human-input/types'
import 'dayjs/locale/en'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/ja'
import 'dayjs/locale/nl'

dayjs.extend(utc)
dayjs.extend(relativeTime)
dayjs.extend(isSameOrAfter)

export const getButtonStyle = (style: UserActionButtonType) => {
  if (style === UserActionButtonType.Primary)
    return 'primary'
  if (style === UserActionButtonType.Default)
    return 'secondary'
  if (style === UserActionButtonType.Accent)
    return 'secondary-accent'
  if (style === UserActionButtonType.Ghost)
    return 'ghost'
}

export const splitByOutputVar = (content: string): string[] => {
  const outputVarRegex = /(\{\{#\$output\.[^#]+#\}\})/g
  const parts = content.split(outputVarRegex)
  return parts.filter(part => part.length > 0)
}

export const initializeInputs = (formInputs: FormInputItem[], defaultValues: Record<string, HumanInputResolvedValue> = {}) => {
  const initialInputs: Record<string, HumanInputFieldValue> = {}
  formInputs.forEach((item) => {
    if (isParagraphFormInput(item)) {
      const resolvedValue = defaultValues[item.output_variable_name]
      initialInputs[item.output_variable_name] = item.default.type === 'variable' && typeof resolvedValue === 'string'
        ? resolvedValue
        : item.default.value
      return
    }

    if (isSelectFormInput(item)) {
      initialInputs[item.output_variable_name] = ''
      return
    }

    if (isFileFormInput(item)) {
      initialInputs[item.output_variable_name] = null
      return
    }

    if (isFileListFormInput(item)) {
      initialInputs[item.output_variable_name] = []
    }
  })
  return initialInputs
}

export const isHumanInputFileUploaded = (value: HumanInputFieldValue | undefined) => {
  return !!value
    && !Array.isArray(value)
    && typeof value !== 'string'
    && !!fileIsUploaded(value as FileEntity)
}

export const hasUploadedHumanInputFiles = (value: HumanInputFieldValue | undefined) => {
  return Array.isArray(value)
    && value.length > 0
    && value.every(file => !!fileIsUploaded(file))
}

export const hasInvalidSelectOrFileInput = (
  formInputs: FormInputItem[],
  values: Record<string, HumanInputFieldValue>,
) => {
  return formInputs.some((input) => {
    const value = values[input.output_variable_name]

    if (isSelectFormInput(input))
      return typeof value !== 'string' || value.length === 0

    if (isFileFormInput(input))
      return Array.isArray(value) ? !hasUploadedHumanInputFiles(value) : !isHumanInputFileUploaded(value)

    if (isFileListFormInput(input))
      return !hasUploadedHumanInputFiles(value)

    return false
  })
}

export const hasInvalidRequiredHumanInput = (
  formInputs: FormInputItem[],
  values: Record<string, HumanInputFieldValue>,
) => {
  return formInputs.some((input) => {
    const value = values[input.output_variable_name]

    if (isParagraphFormInput(input))
      return typeof value !== 'string' || value.trim().length === 0

    if (isSelectFormInput(input))
      return typeof value !== 'string' || value.length === 0

    if (isFileFormInput(input))
      return Array.isArray(value) ? !hasUploadedHumanInputFiles(value) : !isHumanInputFileUploaded(value)

    if (isFileListFormInput(input))
      return !hasUploadedHumanInputFiles(value)

    return false
  })
}

export const getProcessedHumanInputFormInputs = (
  formInputs: FormInputItem[],
  values: Record<string, HumanInputFieldValue> | undefined,
) => {
  if (!values)
    return undefined

  const processedInputs: Record<string, unknown> = { ...values }

  formInputs.forEach((input) => {
    const value = values[input.output_variable_name]

    if (isFileListFormInput(input)) {
      processedInputs[input.output_variable_name] = Array.isArray(value)
        ? getProcessedFiles(value)
        : []
      return
    }

    if (isFileFormInput(input)) {
      if (Array.isArray(value)) {
        processedInputs[input.output_variable_name] = getProcessedFiles(value)[0]
        return
      }

      processedInputs[input.output_variable_name] = value && typeof value !== 'string'
        ? getProcessedFiles([value as FileEntity])[0]
        : undefined
    }
  })

  return processedInputs
}

const localeMap: Record<string, string> = {
  'en-US': 'en',
  'zh-Hans': 'zh-cn',
  'ja-JP': 'ja',
  'nl-NL': 'nl',
}

export const getRelativeTime = (
  utcTimestamp: string | number,
  locale: Locale = 'en-US',
) => {
  const dayjsLocale = localeMap[locale] ?? 'en'

  return dayjs
    .utc(utcTimestamp)
    .locale(dayjsLocale)
    .fromNow()
}

export const isRelativeTimeSameOrAfter = (utcTimestamp: string | number) => {
  return dayjs.utc(utcTimestamp).isSameOrAfter(dayjs())
}
