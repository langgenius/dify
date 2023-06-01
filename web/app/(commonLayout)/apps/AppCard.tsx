'use client'

import { useContext, useContextSelector } from 'use-context-selector'
import Link from 'next/link'
import type { MouseEventHandler } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import style from '../list.module.css'
import AppModeLabel from './AppModeLabel'
import type { App } from '@/types/app'
import Confirm from '@/app/components/base/confirm'
import { ToastContext } from '@/app/components/base/toast'
import { deleteApp } from '@/service/apps'
import AppIcon from '@/app/components/base/app-icon'
import AppsContext from '@/context/app-context'

export type AppCardProps = {
  app: App
  onDelete?: () => void
}

const AppCard = ({
  app,
  onDelete,
}: AppCardProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const mutateApps = useContextSelector(AppsContext, state => state.mutateApps)

  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const onDeleteClick: MouseEventHandler = useCallback((e) => {
    e.preventDefault()
    setShowConfirmDelete(true)
  }, [])
  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteApp(app.id)
      notify({ type: 'success', message: t('app.appDeleted') })
      if (onDelete)
        onDelete()
      mutateApps()
    }
    catch (e: any) {
      notify({ type: 'error', message: `${t('app.appDeleteFailed')}${'message' in e ? `: ${e.message}` : ''}` })
    }
    setShowConfirmDelete(false)
  }, [app.id])

  return (
    <>
      <Link href={`/app/${app.id}/overview`} className={style.listItem}>
        <div className={style.listItemTitle}>
          <AppIcon size='small' icon={app.icon} background={app.icon_background} />
          <div className={style.listItemHeading}>
            <div className={style.listItemHeadingContent}>{app.name}</div>
          </div>
          <span className={style.deleteAppIcon} onClick={onDeleteClick} />
        </div>
        <div className={style.listItemDescription}>{app.model_config?.pre_prompt}</div>
        <div className={style.listItemFooter}>
          <AppModeLabel mode={app.mode} />
        </div>

        {showConfirmDelete && (
          <Confirm
            title={t('app.deleteAppConfirmTitle')}
            content={t('app.deleteAppConfirmContent')}
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

export default AppCard
