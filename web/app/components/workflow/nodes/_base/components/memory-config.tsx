'use client'
import type { FC } from 'react'
import type { Memory } from '../../../types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Slider from '@/app/components/base/slider'
import Switch from '@/app/components/base/switch'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { cn } from '@/utils/classnames'
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
const RoleItem: FC<RoleItemProps> = ({
  readonly,
  title,
  value,
  onChange,
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }, [onChange])
  return (
    <div className="flex items-center justify-between">
      <div className="text-[13px] font-normal text-text-secondary">{title}</div>
      <Input
        readOnly={readonly}
        value={value}
        onChange={handleChange}
        className="h-8 w-[200px]"
        type="text"
      />
    </div>
  )
}

type Props = {
  className?: string
  readonly: boolean
  config: { data?: Memory }
  onChange: (memory?: Memory) => void
  canSetRoleName?: boolean
}

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
}) => {
  const { t } = useTranslation()
  const payload = config.data
  const handleMemoryEnabledChange = useCallback((enabled: boolean) => {
    onChange(enabled ? MEMORY_DEFAULT : undefined)
  }, [onChange])
  const handleWindowEnabledChange = useCallback((enabled: boolean) => {
    const newPayload = produce(config.data || MEMORY_DEFAULT, (draft) => {
      if (!draft.window)
        draft.window = { enabled: false, size: WINDOW_SIZE_DEFAULT }

      draft.window.enabled = enabled
    })

    onChange(newPayload)
  }, [config, onChange])

  const handleWindowSizeChange = useCallback((size: number | string) => {
    const newPayload = produce(payload || MEMORY_DEFAULT, (draft) => {
      if (!draft.window)
        draft.window = { enabled: true, size: WINDOW_SIZE_DEFAULT }
      let limitedSize: null | string | number = size
      if (limitedSize === '') {
        limitedSize = null
      }
      else {
        limitedSize = Number.parseInt(limitedSize as string, 10)
        if (isNaN(limitedSize))
          limitedSize = WINDOW_SIZE_DEFAULT

        if (limitedSize < WINDOW_SIZE_MIN)
          limitedSize = WINDOW_SIZE_MIN

        if (limitedSize > WINDOW_SIZE_MAX)
          limitedSize = WINDOW_SIZE_MAX
      }

      draft.window.size = limitedSize as number
    })
    onChange(newPayload)
  }, [payload, onChange])

  const handleBlur = useCallback(() => {
    const payload = config.data
    if (!payload)
      return

    if (payload.window.size === '' || payload.window.size === null)
      handleWindowSizeChange(WINDOW_SIZE_DEFAULT)
  }, [handleWindowSizeChange, config])

  const handleRolePrefixChange = useCallback((role: MemoryRole) => {
    return (value: string) => {
      const newPayload = produce(config.data || MEMORY_DEFAULT, (draft) => {
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
  }, [config, onChange])
  return (
    <div className={cn(className)}>
      <Field
        title={t(`${i18nPrefix}.memory`, { ns: 'workflow' })}
        tooltip={t(`${i18nPrefix}.memoryTip`, { ns: 'workflow' })!}
        operations={(
          <Switch
            defaultValue={!!payload}
            onChange={handleMemoryEnabledChange}
            size="md"
            disabled={readonly}
          />
        )}
      >
        {payload && (
          <>
            {/* window size */}
            <div className="flex justify-between">
              <div className="flex h-8 items-center space-x-2">
                <Switch
                  defaultValue={payload?.window?.enabled}
                  onChange={handleWindowEnabledChange}
                  size="md"
                  disabled={readonly}
                />
                <div className="system-xs-medium-uppercase text-text-tertiary">{t(`${i18nPrefix}.windowSize`, { ns: 'workflow' })}</div>
              </div>
              <div className="flex h-8 items-center space-x-2">
                <Slider
                  className="w-[144px]"
                  value={(payload.window?.size || WINDOW_SIZE_DEFAULT) as number}
                  min={WINDOW_SIZE_MIN}
                  max={WINDOW_SIZE_MAX}
                  step={1}
                  onChange={handleWindowSizeChange}
                  disabled={readonly || !payload.window?.enabled}
                />
                <Input
                  value={(payload.window?.size || WINDOW_SIZE_DEFAULT) as number}
                  wrapperClassName="w-12"
                  className="appearance-none pr-0"
                  type="number"
                  min={WINDOW_SIZE_MIN}
                  max={WINDOW_SIZE_MAX}
                  step={1}
                  onChange={e => handleWindowSizeChange(e.target.value)}
                  onBlur={handleBlur}
                  disabled={readonly || !payload.window?.enabled}
                />
              </div>
            </div>
            {canSetRoleName && (
              <div className="mt-4">
                <div className="text-xs font-medium uppercase leading-6 text-text-tertiary">{t(`${i18nPrefix}.conversationRoleName`, { ns: 'workflow' })}</div>
                <div className="mt-1 space-y-2">
                  <RoleItem
                    readonly={readonly}
                    title={t(`${i18nPrefix}.user`, { ns: 'workflow' })}
                    value={payload.role_prefix?.user || ''}
                    onChange={handleRolePrefixChange(MemoryRole.user)}
                  />
                  <RoleItem
                    readonly={readonly}
                    title={t(`${i18nPrefix}.assistant`, { ns: 'workflow' })}
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
