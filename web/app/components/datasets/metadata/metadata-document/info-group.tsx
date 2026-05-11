'use client'
import type { FC } from 'react'
import type { BuiltInMetadataItem, MetadataItemWithValue } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiDeleteBinLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { Infotip } from '@/app/components/base/infotip'
import useTimestamp from '@/hooks/use-timestamp'
import { useRouter } from '@/next/navigation'
import AddMetadataButton from '../add-metadata-button'
import InputCombined from '../edit-metadata-batch/input-combined'
import SelectMetadataModal from '../metadata-dataset/select-metadata-modal'
import { DataType, isShowManageMetadataLocalStorageKey } from '../types'
import Field from './field'

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
  onAdd?: (item: BuiltInMetadataItem) => void
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
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1">
            <div className={cn('text-text-secondary', uppercaseTitle ? 'system-xs-semibold-uppercase' : 'system-md-semibold')}>{title}</div>
            {titleTooltip && (
              <Infotip aria-label={titleTooltip} popupClassName="max-w-[240px]">
                {titleTooltip}
              </Infotip>
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
            {list.length > 0 && <Divider className="my-3" bgStyle="gradient" />}
          </div>
        )}
        {list.map((item, i) => (
          <Field key={(item.id && item.id !== 'built-in') ? item.id : `${i}`} label={item.name}>
            {isEdit
              ? (
                  <div className="flex items-center space-x-0.5">
                    <InputCombined
                      className="h-6"
                      type={item.type}
                      value={item.value}
                      onChange={value => onChange?.({ ...item, value })}
                    />
                    <button
                      type="button"
                      aria-label={t('operation.remove', { ns: 'common' })}
                      className="shrink-0 cursor-pointer rounded-md border-none bg-transparent p-1 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                      onClick={() => onDelete?.(item)}
                    >
                      <RiDeleteBinLine className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                )
              : (<div className="py-1 system-xs-regular text-text-secondary">{(item.value && item.type === DataType.time) ? formatTimestamp((item.value as number), t('metadata.dateTimeFormat', { ns: 'datasetDocuments' })) : item.value}</div>)}
          </Field>
        ))}
      </div>
    </div>
  )
}
export default React.memo(InfoGroup)
