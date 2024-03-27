'use client'

import { useContext } from 'use-context-selector'
import Link from 'next/link'
import type { MouseEventHandler } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import style from '../list.module.css'
import Confirm from '@/app/components/base/confirm'
import { ToastContext } from '@/app/components/base/toast'
import { deleteDataset } from '@/service/datasets'
import AppIcon from '@/app/components/base/app-icon'
import type { DataSet } from '@/models/datasets'
import Tooltip from '@/app/components/base/tooltip'

export type DatasetCardProps = {
  dataset: DataSet
  onDelete?: () => void
}

const DatasetCard = ({
  dataset,
  onDelete,
}: DatasetCardProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const onDeleteClick: MouseEventHandler = useCallback((e) => {
    e.preventDefault()
    setShowConfirmDelete(true)
  }, [])
  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteDataset(dataset.id)
      notify({ type: 'success', message: t('dataset.datasetDeleted') })
      if (onDelete)
        onDelete()
    }
    catch (e: any) {
      notify({ type: 'error', message: `${t('dataset.datasetDeleteFailed')}${'message' in e ? `: ${e.message}` : ''}` })
    }
    setShowConfirmDelete(false)
  }, [dataset.id])

  return (
    <>
      <Link href={`/datasets/${dataset.id}/documents`} className={cn(style.listItem)} data-disable-nprogress={true}>
        <div className={style.listItemTitle}>
          <AppIcon size='small' className={cn(!dataset.embedding_available && style.unavailable)} />
          <div className={cn(style.listItemHeading, !dataset.embedding_available && style.unavailable)}>
            <div className={style.listItemHeadingContent}>
              {dataset.name}
            </div>
          </div>
          {!dataset.embedding_available && (
            <Tooltip
              selector={`dataset-tag-${dataset.id}`}
              htmlContent={t('dataset.unavailableTip')}
            >
              <span className='px-1 border boder-gray-200 rounded-md text-gray-500 text-xs font-normal leading-[18px]'>{t('dataset.unavailable')}</span>
            </Tooltip>
          )}
          <span className={style.deleteDatasetIcon} onClick={onDeleteClick} />
        </div>
        <div className={cn(style.listItemDescription, !dataset.embedding_available && style.unavailable)}>{dataset.description}</div>
        <div className={cn(style.listItemFooter, style.datasetCardFooter, !dataset.embedding_available && style.unavailable)}>
          <span className={style.listItemStats}>
            <span className={cn(style.listItemFooterIcon, style.docIcon)} />
            {dataset.document_count}{t('dataset.documentCount')}
          </span>
          <span className={style.listItemStats}>
            <span className={cn(style.listItemFooterIcon, style.textIcon)} />
            {Math.round(dataset.word_count / 1000)}{t('dataset.wordCount')}
          </span>
          <span className={style.listItemStats}>
            <span className={cn(style.listItemFooterIcon, style.applicationIcon)} />
            {dataset.app_count}{t('dataset.appCount')}
          </span>
        </div>

        {showConfirmDelete && (
          <Confirm
            title={t('dataset.deleteDatasetConfirmTitle')}
            content={t('dataset.deleteDatasetConfirmContent')}
            isShow={showConfirmDelete}
            onClose={() => setShowConfirmDelete(false)}
            onConfirm={onConfirmDelete}
            onCancel={() => setShowConfirmDelete(false)}
          />
        )}
      </Link>
    </>
  )
}

export default DatasetCard
