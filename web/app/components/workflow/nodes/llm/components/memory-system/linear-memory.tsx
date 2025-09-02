import {
  memo,
  useCallback,
} from 'react'
import { produce } from 'immer'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Slider from '@/app/components/base/slider'
import Input from '@/app/components/base/input'
import type { Memory } from '@/app/components/workflow/types'
import { MemoryRole } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

const WINDOW_SIZE_MIN = 1
const WINDOW_SIZE_MAX = 100
export const WINDOW_SIZE_DEFAULT = 50
export const MEMORY_DEFAULT: Memory = {
  window: { enabled: false, size: WINDOW_SIZE_DEFAULT },
  query_prompt_template: '{{#sys.query#}}\n\n{{#sys.files#}}',
}
type RoleItemProps = {
  readonly?: boolean
  title: string
  value: string
  onChange: (value: string) => void
}
const RoleItem = ({
  readonly,
  title,
  value,
  onChange,
}: RoleItemProps) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }, [onChange])
  return (
    <div className='flex items-center justify-between'>
      <div className='text-[13px] font-normal text-text-secondary'>{title}</div>
      <Input
        readOnly={readonly}
        value={value}
        onChange={handleChange}
        className='h-8 w-[200px]'
        type='text' />
    </div>
  )
}

type LinearMemoryProps = {
  payload: Memory
  readonly?: boolean
  onChange: (payload: Memory) => void
  canSetRoleName?: boolean
  className?: string
}
const LinearMemory = ({
  payload,
  readonly,
  onChange,
  canSetRoleName,
  className,
}: LinearMemoryProps) => {
  const i18nPrefix = 'workflow.nodes.common.memory'
  const { t } = useTranslation()
  const handleWindowEnabledChange = useCallback((enabled: boolean) => {
    const newPayload = produce(payload || MEMORY_DEFAULT, (draft) => {
      if (!draft.window)
        draft.window = { enabled: false, size: WINDOW_SIZE_DEFAULT }

      draft.window.enabled = enabled
    })

    onChange(newPayload)
  }, [payload, onChange])

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
        if (Number.isNaN(limitedSize))
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
    if (!payload)
      return

    if (payload.window.size === '' || payload.window.size === null)
      handleWindowSizeChange(WINDOW_SIZE_DEFAULT)
  }, [handleWindowSizeChange, payload])
  const handleRolePrefixChange = useCallback((role: MemoryRole) => {
    return (value: string) => {
      const newPayload = produce(payload || MEMORY_DEFAULT, (draft) => {
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
  }, [payload, onChange])

  return (
    <>
      <div className={cn('flex justify-between', className)}>
        <div className='flex h-8 items-center space-x-2'>
          <Switch
            defaultValue={payload?.window?.enabled}
            onChange={handleWindowEnabledChange}
            size='md'
            disabled={readonly}
          />
          <div className='system-xs-medium-uppercase text-text-tertiary'>{t(`${i18nPrefix}.windowSize`)}</div>
        </div>
        <div className='flex h-8 items-center space-x-2'>
          <Slider
            className='w-[144px]'
            value={(payload.window?.size || WINDOW_SIZE_DEFAULT) as number}
            min={WINDOW_SIZE_MIN}
            max={WINDOW_SIZE_MAX}
            step={1}
            onChange={handleWindowSizeChange}
            disabled={readonly || !payload.window?.enabled}
          />
          <Input
            value={(payload.window?.size || WINDOW_SIZE_DEFAULT) as number}
            wrapperClassName='w-12'
            className='appearance-none pr-0'
            type='number'
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
        <div className='mt-4'>
          <div className='text-xs font-medium uppercase leading-6 text-text-tertiary'>{t(`${i18nPrefix}.conversationRoleName`)}</div>
          <div className='mt-1 space-y-2'>
            <RoleItem
              readonly={!!readonly}
              title={t(`${i18nPrefix}.user`)}
              value={payload.role_prefix?.user || ''}
              onChange={handleRolePrefixChange(MemoryRole.user)}
            />
            <RoleItem
              readonly={!!readonly}
              title={t(`${i18nPrefix}.assistant`)}
              value={payload.role_prefix?.assistant || ''}
              onChange={handleRolePrefixChange(MemoryRole.assistant)}
            />
          </div>
        </div>
      )}
    </>
  )
}

export default memo(LinearMemory)
