import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Locale } from '@/i18n-config'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import utc from 'dayjs/plugin/utc'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import 'dayjs/locale/en'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/ja'

dayjs.extend(utc)
dayjs.extend(relativeTime)

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

export const initializeInputs = (formInputs: FormInputItem[]) => {
  const initialInputs: Record<string, any> = {}
  formInputs.forEach((item) => {
    if (item.type === 'text-input' || item.type === 'paragraph')
      initialInputs[item.output_variable_name] = ''
    else
      initialInputs[item.output_variable_name] = undefined
  })
  return initialInputs
}

const localeMap: Record<string, string> = {
  'en-US': 'en',
  'zh-Hans': 'zh-cn',
  'ja-JP': 'ja',
}

export const formatRelativeTimeInZone = (
  utcTimestamp: string | number,
  locale: Locale = 'en-US',
) => {
  const dayjsLocale = localeMap[locale] ?? 'en'

  return dayjs
    .utc(utcTimestamp)
    .locale(dayjsLocale)
    .fromNow()
}
