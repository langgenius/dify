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
          <Variable02 className='text-text-accent mr-[5px] h-3.5 w-3.5' />
          <span className='text-text-secondary system-sm-medium'>{item.name}</span>
        </div>
        <span className='text-text-tertiary system-xs-regular'>{item.type}</span>
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
          <div className='group/sub-variable-picker bg-components-input-bg-normal hover:bg-state-base-hover-alt flex h-8 items-center rounded-lg pl-1'>
            {item
              ? <div className='flex cursor-pointer justify-start'>
                <div className='border-components-panel-border-subtle bg-components-badge-white-to-dark shadow-xs text-text-accent inline-flex h-6 max-w-full items-center rounded-md border-[0.5px] px-1.5'>
                  <Variable02 className='text-text-accent h-3.5 w-3.5 shrink-0' />
                  <div className='system-xs-medium ml-0.5 truncate'>{item?.name}</div>
                </div>
              </div>
              : <div className='text-components-input-text-placeholder system-sm-regular group-hover/sub-variable-picker:text-text-tertiary flex  pl-1'>
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
