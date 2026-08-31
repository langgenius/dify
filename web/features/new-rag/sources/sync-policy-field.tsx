'use client'

import type { TFunction } from 'i18next'
import type { RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
} from '@langgenius/dify-ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HOUR_SECONDS = 3_600
const DAY_SECONDS = 24 * HOUR_SECONDS
const MIN_SYNC_INTERVAL_SECONDS = HOUR_SECONDS
const MAX_SYNC_INTERVAL_SECONDS = 30 * DAY_SECONDS
export const DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS = 36 * HOUR_SECONDS

export type SyncPolicyMode = 'custom' | 'interval' | 'manual'
export type SyncPolicyValue = {
  customIntervalSeconds?: number
  mode: SyncPolicyMode
}

type SyncPolicyChoice =
  | 'custom'
  | 'custom-edit'
  | 'interval-6-hours'
  | 'interval-12-hours'
  | 'interval-24-hours'
  | 'interval-3-days'
  | 'interval-7-days'
  | 'manual'

type IntervalUnit = 'days' | 'hours'

const presetIntervals = [
  { choice: 'interval-6-hours', seconds: 6 * HOUR_SECONDS },
  { choice: 'interval-12-hours', seconds: 12 * HOUR_SECONDS },
  { choice: 'interval-24-hours', seconds: DAY_SECONDS },
  { choice: 'interval-3-days', seconds: 3 * DAY_SECONDS },
  { choice: 'interval-7-days', seconds: 7 * DAY_SECONDS },
] as const satisfies ReadonlyArray<{
  choice: SyncPolicyChoice
  seconds: number
}>

function clampedIntervalSeconds(value: number) {
  return Math.min(MAX_SYNC_INTERVAL_SECONDS, Math.max(MIN_SYNC_INTERVAL_SECONDS, value))
}

function choiceForValue(value: SyncPolicyValue): SyncPolicyChoice {
  if (value.mode === 'manual') return value.mode
  if (value.mode === 'interval') return 'interval-24-hours'
  return (
    presetIntervals.find((option) => option.seconds === value.customIntervalSeconds)?.choice ??
    'custom'
  )
}

function secondsForChoice(choice: SyncPolicyChoice) {
  return presetIntervals.find((option) => option.choice === choice)?.seconds
}

function initialEditorValue(seconds: number) {
  const clamped = clampedIntervalSeconds(seconds)
  if (clamped >= DAY_SECONDS && clamped % DAY_SECONDS === 0)
    return { unit: 'days' as const, value: clamped / DAY_SECONDS }
  return { unit: 'hours' as const, value: Math.max(1, Math.round(clamped / HOUR_SECONDS)) }
}

function syncPolicyValueLabel(t: TFunction<'dataset'>, language: string, value: SyncPolicyValue) {
  if (value.mode === 'manual') return t(($) => $['newKnowledge.syncPolicyManual'])
  if (value.mode === 'interval') return t(($) => $['newKnowledge.syncPolicyDaily'])

  const seconds = clampedIntervalSeconds(
    value.customIntervalSeconds ?? DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS,
  )
  const formatter = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: seconds % DAY_SECONDS === 0 ? 'day' : 'hour',
    unitDisplay: 'long',
  })
  const interval = formatter
    .formatToParts(seconds % DAY_SECONDS === 0 ? seconds / DAY_SECONDS : seconds / HOUR_SECONDS)
    .map((part, index, parts) => {
      const previousPart = parts[index - 1]
      if (
        language.toLowerCase().startsWith('zh') &&
        part.type === 'unit' &&
        previousPart?.type !== 'literal'
      )
        return ` ${part.value}`
      return part.value
    })
    .join('')
  return t(($) => $['newKnowledge.syncPolicyEveryValue'], { interval })
}

function CustomIntervalPopover({
  anchorRef,
  disabled,
  initialSeconds,
  open,
  onApply,
  onOpenChange,
}: {
  anchorRef: RefObject<HTMLElement | null>
  disabled: boolean
  initialSeconds: number
  open: boolean
  onApply: (seconds: number) => void
  onOpenChange: (open: boolean) => void
}) {
  const { i18n, t } = useTranslation('dataset')
  const tCommon = useTranslation('common').t
  const initial = initialEditorValue(initialSeconds)
  const [unit, setUnit] = useState<IntervalUnit>(initial.unit)
  const [amount, setAmount] = useState<number | null>(initial.value)

  const maximum = unit === 'days' ? 30 : 720
  const normalizedAmount = Math.min(maximum, Math.max(1, Math.round(amount ?? 1)))
  const intervalSeconds = normalizedAmount * (unit === 'days' ? DAY_SECONDS : HOUR_SECONDS)
  const intervalLabel = syncPolicyValueLabel(t, i18n.resolvedLanguage ?? i18n.language, {
    customIntervalSeconds: intervalSeconds,
    mode: 'custom',
  })

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverPortal>
        <PopoverPositioner anchor={anchorRef} placement="bottom-start" sideOffset={4}>
          <PopoverPopup className="w-75 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-3.5 shadow-lg">
            <PopoverTitle className="system-sm-medium text-text-primary">
              {t(($) => $['newKnowledge.syncPolicyCustom'])}
            </PopoverTitle>
            <div className="mt-3 flex items-center gap-2">
              <span className="shrink-0 system-sm-regular text-text-secondary">
                {t(($) => $['newKnowledge.syncPolicyEvery'])}
              </span>
              <NumberField
                disabled={disabled}
                min={1}
                max={maximum}
                step={1}
                value={amount}
                onValueChange={(next) => setAmount(next)}
              >
                <NumberFieldGroup className="w-18">
                  <NumberFieldInput
                    aria-label={`${t(($) => $['newKnowledge.syncPolicyCustom'])} ${t(($) => $[`newKnowledge.syncPolicyUnit.${unit}`])}`}
                    onBlur={() => setAmount(normalizedAmount)}
                  />
                  <NumberFieldControls>
                    <NumberFieldIncrement />
                    <NumberFieldDecrement />
                  </NumberFieldControls>
                </NumberFieldGroup>
              </NumberField>
              <Select<IntervalUnit>
                disabled={disabled}
                value={unit}
                onValueChange={(nextUnit) => {
                  if (!nextUnit) return
                  setUnit(nextUnit)
                  setAmount(Math.min(nextUnit === 'days' ? 30 : 720, normalizedAmount))
                }}
              >
                <SelectLabel className="sr-only">
                  {t(($) => $['newKnowledge.syncPolicyCustom'])}
                </SelectLabel>
                <SelectTrigger>{t(($) => $[`newKnowledge.syncPolicyUnit.${unit}`])}</SelectTrigger>
                <SelectContent>
                  {(['hours', 'days'] as const).map((option) => (
                    <SelectItem key={option} value={option}>
                      <SelectItemText>
                        {t(($) => $[`newKnowledge.syncPolicyUnit.${option}`])}
                      </SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="mt-3 system-xs-regular leading-3.75 text-text-tertiary">
              {t(($) => $['newKnowledge.syncPolicyCustomHelp'], { interval: intervalLabel })}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="small" disabled={disabled} onClick={() => onOpenChange(false)}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                size="small"
                variant="primary"
                disabled={disabled}
                onClick={() => onApply(intervalSeconds)}
              >
                {t(($) => $['newKnowledge.syncPolicyApply'])}
              </Button>
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}

export function SyncPolicyField({
  className,
  disabled = false,
  label = true,
  size,
  triggerClassName,
  value,
  onChange,
}: {
  className?: string
  disabled?: boolean
  label?: boolean
  size?: 'large' | 'medium'
  triggerClassName?: string
  value: SyncPolicyValue
  onChange: (value: SyncPolicyValue) => void
}) {
  const { i18n, t } = useTranslation('dataset')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const selectedChoice = choiceForValue(value)
  const customIntervalSelected = value.mode === 'custom' && !secondsForChoice(selectedChoice)
  const committedCustomSeconds = customIntervalSelected
    ? (value.customIntervalSeconds ?? DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS)
    : DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS

  const applyChoice = (choice: SyncPolicyChoice | null) => {
    if (!choice) return
    if (choice === 'custom' || choice === 'custom-edit') {
      window.requestAnimationFrame(() => setCustomOpen(true))
      return
    }
    if (choice === 'manual') {
      onChange({ mode: choice })
      return
    }
    const seconds = secondsForChoice(choice)
    if (!seconds) return
    onChange(
      seconds === DAY_SECONDS
        ? { mode: 'interval' }
        : { customIntervalSeconds: seconds, mode: 'custom' },
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Select<SyncPolicyChoice>
        name="syncPolicy"
        disabled={disabled}
        value={selectedChoice}
        onValueChange={applyChoice}
      >
        {label && <SelectLabel>{t(($) => $['newKnowledge.syncPolicy'])}</SelectLabel>}
        <SelectTrigger ref={anchorRef} className={triggerClassName} size={size}>
          {syncPolicyValueLabel(t, i18n.resolvedLanguage ?? i18n.language, value)}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">
            <SelectItemText>{t(($) => $['newKnowledge.syncPolicyManual'])}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          {presetIntervals.map((option) => (
            <SelectItem key={option.choice} value={option.choice}>
              <SelectItemText>
                {syncPolicyValueLabel(t, i18n.resolvedLanguage ?? i18n.language, {
                  customIntervalSeconds: option.seconds,
                  mode: option.seconds === DAY_SECONDS ? 'interval' : 'custom',
                })}
              </SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
          <SelectSeparator />
          {customIntervalSelected ? (
            <SelectItem value="custom">
              <SelectItemText>
                {t(($) => $['newKnowledge.syncPolicyCustomValue'], {
                  interval: syncPolicyValueLabel(
                    t,
                    i18n.resolvedLanguage ?? i18n.language,
                    value,
                  ).toLocaleLowerCase(i18n.resolvedLanguage ?? i18n.language),
                })}
              </SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ) : (
            <SelectItem value="custom">
              <SelectItemText>{t(($) => $['newKnowledge.syncPolicyCustom'])}</SelectItemText>
            </SelectItem>
          )}
          {customIntervalSelected && (
            <SelectItem value="custom-edit">
              <SelectItemText>{t(($) => $['newKnowledge.syncPolicyEditCustom'])}</SelectItemText>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {customOpen && (
        <CustomIntervalPopover
          anchorRef={anchorRef}
          disabled={disabled}
          initialSeconds={committedCustomSeconds}
          open
          onApply={(seconds) => {
            onChange({ customIntervalSeconds: seconds, mode: 'custom' })
            setCustomOpen(false)
          }}
          onOpenChange={setCustomOpen}
        />
      )}
      {customIntervalSelected && (
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.syncPolicyCustomDescription'], {
            interval: syncPolicyValueLabel(
              t,
              i18n.resolvedLanguage ?? i18n.language,
              value,
            ).toLocaleLowerCase(i18n.resolvedLanguage ?? i18n.language),
          })}
        </p>
      )}
    </div>
  )
}
