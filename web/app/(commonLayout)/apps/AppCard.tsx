'use client'

import { useContext, useContextSelector } from 'use-context-selector'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import style from '../list.module.css'
import AppModeLabel from './AppModeLabel'
import s from './style.module.css'
import SettingsModal from '@/app/components/app/overview/settings'
import type { App } from '@/types/app'
import Confirm from '@/app/components/base/confirm'
import { ToastContext } from '@/app/components/base/toast'
import { deleteApp, fetchAppDetail, updateAppSiteConfig } from '@/service/apps'
import AppIcon from '@/app/components/base/app-icon'
import AppsContext, { useAppContext } from '@/context/app-context'
import CustomPopover from '@/app/components/base/popover'
import Divider from '@/app/components/base/divider'
import { asyncRunSafe } from '@/utils'

export type AppCardProps = {
  app: App
  onRefresh?: () => void
}

const AppCard = ({ app, onRefresh }: AppCardProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { isCurrentWorkspaceManager } = useAppContext()

  const mutateApps = useContextSelector(
    AppsContext,
    state => state.mutateApps,
  )

  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [detailState, setDetailState] = useState<{
    loading: boolean
    detail?: App
  }>({ loading: false })

  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteApp(app.id)
      notify({ type: 'success', message: t('app.appDeleted') })
      if (onRefresh)
        onRefresh()
      mutateApps()
    }
    catch (e: any) {
      notify({
        type: 'error',
        message: `${t('app.appDeleteFailed')}${
          'message' in e ? `: ${e.message}` : ''
        }`,
      })
    }
    setShowConfirmDelete(false)
  }, [app.id])

  const getAppDetail = async () => {
    setDetailState({ loading: true })
    const [err, res] = await asyncRunSafe<App>(
      fetchAppDetail({ url: '/apps', id: app.id }) as Promise<App>,
    )
    if (!err) {
      setDetailState({ loading: false, detail: res })
      setShowSettingsModal(true)
    }
    else { setDetailState({ loading: false }) }
  }

  const onSaveSiteConfig = useCallback(
    async (params: any) => {
      const [err] = await asyncRunSafe<App>(
        updateAppSiteConfig({
          url: `/apps/${app.id}/site`,
          body: params,
        }) as Promise<App>,
      )
      if (!err) {
        notify({
          type: 'success',
          message: t('common.actionMsg.modifiedSuccessfully'),
        })
        if (onRefresh)
          onRefresh()
        mutateApps()
      }
      else {
        notify({
          type: 'error',
          message: t('common.actionMsg.modificationFailed'),
        })
      }
    },
    [app.id],
  )

  const Operations = (props: any) => {
    const onClickSettings = async (e: any) => {
      props?.onClose()
      e.preventDefault()
      await getAppDetail()
    }
    const onClickDelete = async (e: any) => {
      props?.onClose()
      e.preventDefault()
      setShowConfirmDelete(true)
    }
    return (
      <div className="w-full py-1">
        <button className={s.actionItem} onClick={onClickSettings} disabled={detailState.loading}>
          <span className={s.actionName}>{t('common.operation.settings')}</span>
        </button>

        <Divider className="!my-1" />
        <div
          className={cn(s.actionItem, s.deleteActionItem, 'group')}
          onClick={onClickDelete}
        >
          <span className={cn(s.actionName, 'group-hover:text-red-500')}>
            {t('common.operation.delete')}
          </span>
        </div>
      </div>
    )
  }

  return (
    <>
      <Link
        href={`/app/${app.id}/overview`}
        className={style.listItem}
      >
        <div className={style.listItemTitle}>
          <AppIcon
            size="small"
            icon={app.icon}
            background={app.icon_background}
          />
          <div className={style.listItemHeading}>
            <div className={style.listItemHeadingContent}>{app.name}</div>
          </div>
          {isCurrentWorkspaceManager && <CustomPopover
            htmlContent={<Operations />}
            position="br"
            trigger="click"
            btnElement={<div className={cn(s.actionIcon, s.commonIcon)} />}
            btnClassName={open =>
              cn(
                open ? '!bg-gray-100 !shadow-none' : '!bg-transparent',
                style.actionIconWrapper,
              )
            }
            className={'!w-[128px] h-fit !z-20'}
          />}
        </div>
        <div className={style.listItemDescription}>
          {app.model_config?.pre_prompt}
        </div>
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
        {showSettingsModal && detailState.detail && (
          <SettingsModal
            appInfo={detailState.detail}
            isShow={showSettingsModal}
            onClose={() => setShowSettingsModal(false)}
            onSave={onSaveSiteConfig}
          />
        )}
      </Link>
    </>
  )
}

export default AppCard
