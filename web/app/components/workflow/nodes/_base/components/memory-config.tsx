'use client'
import type { FC } from 'react'
import type { Memory } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Input } from '@langgenius/dify-ui/input'
import { NumberField, NumberFieldGroup, NumberFieldInput } from '@langgenius/dify-ui/number-field'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
} from '@langgenius/dify-ui/slider'
import { Switch } from '@langgenius/dify-ui/switch'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { MemoryRole } from '../../../types'

const i18nPrefix = 'nodes.common.memory'
const WINDOW_SIZE_MIN = 1
const WINDOW_SIZE_MAX = 100
const WINDOW_SIZE_DEFAULT = 50
type RoleItemProps = {
  readonly: boolean
  title: string
  value: string
  onChange: (value: string) => void
}
const RoleItem: FC<RoleItemProps> = ({ readonly, title, value, onChange }) => {
  const inputId = useId()
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={inputId} className="text-[13px] font-normal text-text-secondary">
        {title}
      </label>
      <div className="w-full">
        <Input
          id={inputId}
          readOnly={readonly}
          value={value}
          onValueChange={onChange}
          className="h-8 w-50"
          type="text"
        />
      </div>
    </div>
  )
}

type Props = Readonly<{
  className?: string
  readonly: boolean
  config: { data?: Memory }
  onChange: (memory?: Memory) => void
  canSetRoleName?: boolean
  defaultMemory?: Memory
}>

const MEMORY_DEFAULT: Memory = {
  window: { enabled: false, size: WINDOW_SIZE_DEFAULT },
  query_prompt_template: '{{#sys.query#}}\n\n{{#sys.files#}}',
}

const MemoryConfig: FC<Props> = ({
  className,
  readonly,
  config = { data: MEMORY_DEFAULT },
  onChange,
  canSetRoleName = false,
  defaultMemory = MEMORY_DEFAULT,
}) => {
  const { t } = useTranslation()
  const payload = config.data
  const windowInputId = useId()
  const windowSize = payload?.window?.size ?? WINDOW_SIZE_DEFAULT
  const windowSizeLabel = t(($) => $[`${i18nPrefix}.windowSize`], { ns: 'workflow' })
  const handleMemoryEnabledChange = useCallback(
    (enabled: boolean) => {
      onChange(enabled ? defaultMemory : undefined)
    },
    [defaultMemory, onChange],
  )
  const handleWindowEnabledChange = useCallback(
    (enabled: boolean) => {
      const newPayload = produce(config.data || defaultMemory, (draft) => {
        if (!draft.window) draft.window = { enabled: false, size: WINDOW_SIZE_DEFAULT }

        draft.window.enabled = enabled
      })

      onChange(newPayload)
    },
    [config, defaultMemory, onChange],
  )

  const handleWindowSizeChange = useCallback(
    (size: number | null) => {
      if (size === null) return
      const newPayload = produce(payload || defaultMemory, (draft) => {
        if (!draft.window) draft.window = { enabled: true, size: WINDOW_SIZE_DEFAULT }
        draft.window.size = size
      })
      onChange(newPayload)
    },
    [payload, defaultMemory, onChange],
  )

  const handleRolePrefixChange = useCallback(
    (role: MemoryRole) => {
      return (value: string) => {
        const newPayload = produce(config.data || defaultMemory, (draft) => {
          if (!draft.role_prefix) {
            draft.role_prefix = {
              user: '',
              assistant: '',
            }
          }
          draft.role_prefix[role] = value
        })
        onChange(newPayload)
      }
    },
    [config, defaultMemory, onChange],
  )
  return (
    <div className={cn(className)}>
      <Field
        title={t(($) => $[`${i18nPrefix}.memory`], { ns: 'workflow' })}
        tooltip={t(($) => $[`${i18nPrefix}.memoryTip`], { ns: 'workflow' })!}
        operations={
          <Switch
            checked={!!payload}
            onCheckedChange={handleMemoryEnabledChange}
            size="md"
            disabled={readonly}
          />
        }
      >
        {payload && (
          <>
            {/* window size */}
            <div className="flex justify-between">
              <div className="flex h-8 items-center space-x-2">
                <Switch
                  checked={payload?.window?.enabled}
                  onCheckedChange={handleWindowEnabledChange}
                  size="md"
                  disabled={readonly}
                />
                <label
                  htmlFor={windowInputId}
                  className="system-xs-medium-uppercase text-text-tertiary"
                >
                  {windowSizeLabel}
                </label>
              </div>
              <Fieldset className="flex h-8 items-center gap-2">
                <FieldsetLegend className="sr-only">{windowSizeLabel}</FieldsetLegend>
                <Slider
                  className="w-36"
                  value={windowSize}
                  min={WINDOW_SIZE_MIN}
                  max={WINDOW_SIZE_MAX}
                  step={1}
                  onValueChange={handleWindowSizeChange}
                  disabled={readonly || !payload.window?.enabled}
                >
                  <SliderLabel className="sr-only">{windowSizeLabel}</SliderLabel>
                  <SliderControl>
                    <SliderTrack>
                      <SliderIndicator />
                      <SliderThumb />
                    </SliderTrack>
                  </SliderControl>
                </Slider>
                <NumberField
                  id={windowInputId}
                  value={windowSize}
                  className="w-12"
                  min={WINDOW_SIZE_MIN}
                  max={WINDOW_SIZE_MAX}
                  step={1}
                  format={{ maximumFractionDigits: 0 }}
                  onValueChange={handleWindowSizeChange}
                  disabled={readonly || !payload.window?.enabled}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput className="pr-0" />
                  </NumberFieldGroup>
                </NumberField>
              </Fieldset>
            </div>
            {canSetRoleName && (
              <div className="mt-4">
                <div className="text-xs/6 font-medium text-text-tertiary uppercase">
                  {t(($) => $[`${i18nPrefix}.conversationRoleName`], { ns: 'workflow' })}
                </div>
                <div className="mt-1 space-y-2">
                  <RoleItem
                    readonly={readonly}
                    title={t(($) => $[`${i18nPrefix}.user`], { ns: 'workflow' })}
                    value={payload.role_prefix?.user || ''}
                    onChange={handleRolePrefixChange(MemoryRole.user)}
                  />
                  <RoleItem
                    readonly={readonly}
                    title={t(($) => $[`${i18nPrefix}.assistant`], { ns: 'workflow' })}
                    value={payload.role_prefix?.assistant || ''}
                    onChange={handleRolePrefixChange(MemoryRole.assistant)}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </Field>
    </div>
  )
}
export default React.memo(MemoryConfig)
