'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SUB_VARIABLES } from '../../if-else/default'
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
      <div className='flex items-center h-6 justify-between'>
        <div className='flex items-center h-full'>
          <Variable02 className='mr-[5px] w-3.5 h-3.5 text-text-accent' />
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
          <div className='group/sub-variable-picker flex items-center h-8 pl-1 rounded-lg bg-components-input-bg-normal hover:bg-state-base-hover-alt'>
            {item
              ? <div className='flex justify-start cursor-pointer'>
                <div className='inline-flex max-w-full px-1.5 items-center h-6 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark shadow-xs text-text-accent'>
                  <Variable02 className='shrink-0 w-3.5 h-3.5 text-text-accent' />
                  <div className='ml-0.5 truncate system-xs-medium'>{item?.name}</div>
                </div>
              </div>
              : <div className='pl-1 flex text-components-input-text-placeholder system-sm-regular  group-hover/sub-variable-picker:text-text-tertiary'>
                <Variable02 className='mr-1 shrink-0 w-4 h-4' />
                <span>{t('common.placeholder.select')}</span>
              </div>}
          </div>
        )}
      />
    </div>
  )
}
export default React.memo(SubVariablePicker)
