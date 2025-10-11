'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SUB_VARIABLES } from '../../constants'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect as Select } from '@/app/components/base/select'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import cn from '@/utils/classnames'

type Props = {
  value: string
  onChange: (value: string) => void
  className?: string
}

const SubVariablePicker: FC<Props> = ({
  value,
  onChange,
  className,
}) => {
  const { t } = useTranslation()
  const subVarOptions = SUB_VARIABLES.map(item => ({
    value: item,
    name: item,
  }))

  const renderOption = ({ item }: { item: Record<string, any> }) => {
    return (
      <div className='flex h-6 items-center justify-between'>
        <div className='flex h-full items-center'>
          <Variable02 className='mr-[5px] h-3.5 w-3.5 text-text-accent' />
          <span className='system-sm-medium text-text-secondary'>{item.name}</span>
        </div>
        <span className='system-xs-regular text-text-tertiary'>{item.type}</span>
      </div>
    )
  }

  const handleChange = useCallback(({ value }: Item) => {
    onChange(value as string)
  }, [onChange])

  return (
    <div className={cn(className)}>
      <Select
        items={subVarOptions}
        defaultValue={value}
        onSelect={handleChange}
        className='!text-[13px]'
        placeholder={t('workflow.nodes.listFilter.selectVariableKeyPlaceholder')!}
        optionClassName='pl-1 pr-5 py-0'
        renderOption={renderOption}
        renderTrigger={item => (
          <div className='group/sub-variable-picker flex h-8 items-center rounded-lg bg-components-input-bg-normal pl-1 hover:bg-state-base-hover-alt'>
            {item
              ? <div className='flex cursor-pointer justify-start'>
                <div className='inline-flex h-6 max-w-full items-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1.5 text-text-accent shadow-xs'>
                  <Variable02 className='h-3.5 w-3.5 shrink-0 text-text-accent' />
                  <div className='system-xs-medium ml-0.5 truncate'>{item?.name}</div>
                </div>
              </div>
              : <div className='system-sm-regular flex pl-1 text-components-input-text-placeholder  group-hover/sub-variable-picker:text-text-tertiary'>
                <Variable02 className='mr-1 h-4 w-4 shrink-0' />
                <span>{t('common.placeholder.select')}</span>
              </div>}
          </div>
        )}
      />
    </div>
  )
}
export default React.memo(SubVariablePicker)
