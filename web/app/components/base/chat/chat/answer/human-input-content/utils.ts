import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Locale } from '@/i18n-config'
import dayjs from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import relativeTime from 'dayjs/plugin/relativeTime'
import utc from 'dayjs/plugin/utc'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
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

export const initializeInputs = (formInputs: FormInputItem[], defaultValues: Record<string, string> = {}) => {
  const initialInputs: Record<string, any> = {}
  formInputs.forEach((item) => {
    if (item.type === 'text-input' || item.type === 'paragraph')
      initialInputs[item.output_variable_name] = item.default.type === 'variable' ? defaultValues[item.output_variable_name] || '' : item.default.value
    else
      initialInputs[item.output_variable_name] = undefined
  })
  return initialInputs
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
