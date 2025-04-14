'use client'
import type { FC } from 'react'
import React from 'react'
import { useRouter } from 'next/navigation'
import { DataType, type MetadataItemWithValue, isShowManageMetadataLocalStorageKey } from '../types'
import Field from './field'
import InputCombined from '../edit-metadata-batch/input-combined'
import { RiDeleteBinLine, RiQuestionLine } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import Divider from '@/app/components/base/divider'
import SelectMetadataModal from '../metadata-dataset/select-metadata-modal'
import AddMetadataButton from '../add-metadata-button'
import useTimestamp from '@/hooks/use-timestamp'
import { useTranslation } from 'react-i18next'

type Props = {
  dataSetId: string
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
  onSelect?: (item: MetadataItemWithValue) => void
  onAdd?: (item: MetadataItemWithValue) => void
}

const InfoGroup: FC<Props> = ({
  dataSetId,
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
  onSelect,
  onAdd,
}) => {
  const router = useRouter()
  const { t } = useTranslation()
  const { formatTime: formatTimestamp } = useTimestamp()

  const handleMangeMetadata = () => {
    localStorage.setItem(isShowManageMetadataLocalStorageKey, 'true')
    router.push(`/datasets/${dataSetId}/documents`)
  }

  return (
    <div className={cn(className)}>
      {!noHeader && (
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-1'>
            <div className={cn('text-text-secondary', uppercaseTitle ? 'system-xs-semibold-uppercase' : 'system-md-semibold')}>{title}</div>
            {titleTooltip && (
              <Tooltip popupContent={<div className='max-w-[240px]'>{titleTooltip}</div>}>
                <div><RiQuestionLine className='size-3.5 text-text-tertiary' /></div>
              </Tooltip>
            )}
          </div>
          {headerRight}
        </div>
      )}

      <div className={cn('mt-3 space-y-1', contentClassName)}>
        {isEdit && (
          <div>
            <SelectMetadataModal
              datasetId={dataSetId}
              trigger={
                <AddMetadataButton />
              }
              onSelect={data => onSelect?.(data as MetadataItemWithValue)}
              onSave={data => onAdd?.(data)}
              onManage={handleMangeMetadata}
            />
            {list.length > 0 && <Divider className='my-3 ' bgStyle='gradient' />}
          </div>
        )}
        {list.map((item, i) => (
          <Field key={(item.id && item.id !== 'built-in') ? item.id : `${i}`} label={item.name}>
            {isEdit ? (
              <div className='flex items-center space-x-0.5'>
                <InputCombined
                  className='h-6'
                  type={item.type}
                  value={item.value}
                  onChange={value => onChange?.({ ...item, value })}
                />
                <div className='shrink-0 cursor-pointer rounded-md p-1  text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive'>
                  <RiDeleteBinLine className='size-4' onClick={() => onDelete?.(item)} />
                </div>
              </div>
            ) : (<div className='system-xs-regular py-1 text-text-secondary'>{(item.value && item.type === DataType.time) ? formatTimestamp((item.value as number), t('datasetDocuments.metadata.dateTimeFormat')) : item.value}</div>)}
          </Field>
        ))}
      </div>
    </div>
  )
}
export default React.memo(InfoGroup)
