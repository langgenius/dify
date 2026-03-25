'use client'
import type { FC } from 'react'
import { PlusIcon } from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import s from '../style.module.css'
import { FolderPlusIcon, NotionIcon, ThreeDotsIcon } from './icons'

type EmptyElementProps = {
  canAdd: boolean
  onClick: () => void
  type?: 'upload' | 'sync'
}

const EmptyElement: FC<EmptyElementProps> = ({ canAdd = true, onClick, type = 'upload' }) => {
  const { t } = useTranslation()
  return (
    <div className={s.emptyWrapper}>
      <div className={s.emptyElement}>
        <div className={s.emptySymbolIconWrapper}>
          {type === 'upload' ? <FolderPlusIcon /> : <NotionIcon />}
        </div>
        <span className={s.emptyTitle}>
          {t('list.empty.title', { ns: 'datasetDocuments' })}
          <ThreeDotsIcon className="relative -left-1.5 -top-3 inline" />
        </span>
        <div className={s.emptyTip}>
          {t(`list.empty.${type}.tip`, { ns: 'datasetDocuments' })}
        </div>
        {type === 'upload' && canAdd && (
          <Button onClick={onClick} className={s.addFileBtn} variant="secondary-accent">
            <PlusIcon className={s.plusIcon} />
            {t('list.addFile', { ns: 'datasetDocuments' })}
          </Button>
        )}
      </div>
    </div>
  )
}

export default EmptyElement
