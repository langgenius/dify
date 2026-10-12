'use client'

import type { DirectionProviderProps } from '@langgenius/dify-ui/direction-provider'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'

export function usePickerLabels() {
  const locale = useLocale()
  const { t } = useTranslation(['time'])
  const period = (hour: number) =>
    new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true, timeZone: 'UTC' })
      .formatToParts(new Date(Date.UTC(2025, 0, 1, hour)))
      .find((part) => part.type === 'dayPeriod')?.value ?? (hour < 12 ? 'AM' : 'PM')
  const direction: DirectionProviderProps['direction'] =
    locale === 'ar-TN' || locale === 'fa-IR' ? 'rtl' : 'ltr'
  return {
    direction,
    locale,
    requiredLabel: t(($) => $['picker.requiredLabel']),
    validationMessage: t(($) => $['picker.required']),
    labels: {
      previousMonth: t(($) => $['picker.previousMonth']),
      nextMonth: t(($) => $['picker.nextMonth']),
      chooseMonthAndYear: t(($) => $['picker.chooseMonthAndYear']),
      month: t(($) => $['picker.month']),
      year: t(($) => $['picker.year']),
      hour: t(($) => $['picker.hour']),
      minute: t(($) => $['picker.minute']),
      period: t(($) => $['picker.period']),
      unavailable: t(($) => $['picker.unavailable']),
      backToDate: t(($) => $['operation.pickDate']),
      cancel: t(($) => $['operation.cancel']),
      apply: t(($) => $['operation.ok']),
      now: t(($) => $['operation.now']),
      title: t(($) => $['title.pickTime']),
      pickTime: t(($) => $['title.pickTime']),
      am: period(0),
      pm: period(12),
    },
  }
}
