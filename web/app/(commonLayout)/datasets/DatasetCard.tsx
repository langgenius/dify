'use client'

import { useContext } from 'use-context-selector'
import Link from 'next/link'
import type { MouseEventHandler } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import style from '../list.module.css'
import Confirm from '@/app/components/base/confirm'
import { ToastContext } from '@/app/components/base/toast'
import { deleteDataset } from '@/service/datasets'
import AppIcon from '@/app/components/base/app-icon'
import type { DataSet } from '@/models/datasets'

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
      <Link href={`/datasets/${dataset.id}/documents`} className={style.listItem}>
        <div className={style.listItemTitle}>
          <AppIcon size='small' />
          <div className={style.listItemHeading}>
            <div className={style.listItemHeadingContent}>{dataset.name}</div>
          </div>
          <span className={style.deleteAppIcon} onClick={onDeleteClick} />
        </div>
        <div className={style.listItemDescription}>{dataset.description}</div>
        <div className={classNames(style.listItemFooter, style.datasetCardFooter)}>
          <span className={style.listItemStats}>
            <span className={classNames(style.listItemFooterIcon, style.docIcon)} />
            {dataset.document_count}{t('dataset.documentCount')}
          </span>
          <span className={style.listItemStats}>
            <span className={classNames(style.listItemFooterIcon, style.textIcon)} />
            {Math.round(dataset.word_count / 1000)}{t('dataset.wordCount')}
          </span>
          <span className={style.listItemStats}>
            <span className={classNames(style.listItemFooterIcon, style.applicationIcon)} />
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
