'use client'
import type { FC } from 'react'
import React from 'react'
import type { MetadataItemWithValue } from '../types'
import Field from './field'
import InputCombined from '../edit-metadata-batch/input-combined'
import { RiDeleteBinLine, RiQuestionLine } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import Divider from '@/app/components/base/divider'
import SelectMetadataModal from '../select-metadata-modal'
import AddMetadataButton from '../add-metadata-button'

type Props = {
  className?: string
  noHeader?: boolean
  title?: string
  uppercaseTitle?: boolean
  titleTooltip?: string
  headerRight?: React.ReactNode
  contentClassName?: string
  list: MetadataItemWithValue[]
  isEdit?: boolean
  onChange?: (item: MetadataItemWithValue) => void
  onDelete?: (item: MetadataItemWithValue) => void
  onAdd?: (item: MetadataItemWithValue) => void
}

const InfoGroup: FC<Props> = ({
  className,
  noHeader,
  title,
  uppercaseTitle = true,
  titleTooltip,
  headerRight,
  contentClassName,
  list,
  isEdit,
  onChange,
  onDelete,
  onAdd,
}) => {
  return (
    <div className={cn('bg-white', className)}>
      {!noHeader && (
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-1'>
            <div className={cn('text-text-secondary', uppercaseTitle ? 'system-xs-semibold-uppercase' : 'system-md-semibold')}>{title}</div>
            {titleTooltip && (
              <Tooltip popupContent={<div className='max-w-[240px]'>{titleTooltip}</div>}>
                <RiQuestionLine className='size-3.5 text-text-tertiary' />
              </Tooltip>
            )}
          </div>
          {headerRight}
          {/* <div className='flex px-1.5 rounded-md hover:bg-components-button-tertiary-bg-hover items-center h-6 space-x-1 cursor-pointer' onClick={() => setIsEdit(true)}>
        </div> */}
        </div>
      )}

      <div className={cn('mt-3 space-y-1', !noHeader && 'mt-0', contentClassName)}>
        {isEdit && (
          <div>
            <SelectMetadataModal
              trigger={
                <AddMetadataButton />
              }
              onSave={() => { }}
            />
            <Divider className='my-3 ' bgStyle='gradient' />
          </div>
        )}
        {list.map((item, i) => (
          <Field key={item.id || `${i}`} label={item.name}>
            {isEdit ? (
              <div className='flex items-center space-x-0.5'>
                <InputCombined
                  className='h-6'
                  type={item.type}
                  value={item.value}
                  onChange={value => onChange?.({ ...item, value })}
                />
                <div className='shrink-0 p-1 rounded-md text-text-tertiary  hover:text-text-destructive hover:bg-state-destructive-hover cursor-pointer'>
                  <RiDeleteBinLine className='size-4' />
                </div>
              </div>
            ) : (<div className='py-1 system-xs-regular text-text-secondary'>{item.value}</div>)}
          </Field>
        ))}
      </div>
    </div>
  )
}
export default React.memo(InfoGroup)
