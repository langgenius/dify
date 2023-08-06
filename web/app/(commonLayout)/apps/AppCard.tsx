'use client'

import { useContext, useContextSelector } from 'use-context-selector'
import Link from 'next/link'
import type { MouseEventHandler } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import style from '../list.module.css'
import AppModeLabel from './AppModeLabel'
import AppSettings from './AppSettings'
import s from './style.module.css'
import type { App } from '@/types/app'
import Confirm from '@/app/components/base/confirm'
import { ToastContext } from '@/app/components/base/toast'
import { deleteApp, updateAppIcon, updateAppName } from '@/service/apps'
import AppIcon from '@/app/components/base/app-icon'
import AppsContext from '@/context/app-context'
import CustomPopover from '@/app/components/base/popover'
import Divider from '@/app/components/base/divider'

export type AppCardProps = {
  app: App
  onRefresh?: () => void
}

const AppCard = ({ app, onRefresh }: AppCardProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const mutateApps = useContextSelector(
    AppsContext,
    state => state.mutateApps,
  )

  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [updateLoading, setUpdateLoading] = useState(false)

  const onClickSettings: MouseEventHandler = useCallback((e) => {
    e.preventDefault()
    setShowSettingsModal(true)
  }, [])

  const onClickDelete: MouseEventHandler = useCallback((e) => {
    e.preventDefault()
    setShowConfirmDelete(true)
  }, [])

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

  const onUpdate = useCallback(
    async (params: { name: App['name']; iconInfo: { icon: string;icon_background: string } }) => {
      const reqList = []
      if (params.name !== app.name) {
        reqList.push(updateAppName({
          url: `/apps/${app.id}/name`,
          body: { name: params.name },
        }))
      }
      if (params.iconInfo.icon !== app.icon || params.iconInfo.icon_background !== app.icon_background)
        reqList.push(updateAppIcon({ url: `/apps/${app.id}/icon`, body: params.iconInfo }))

      if (!reqList.length) {
        setShowSettingsModal(false)
        notify({
          type: 'info',
          message: t('common.actionMsg.noModification'),
        })
        return
      }
      setUpdateLoading(true)
      const updateRes = await Promise.allSettled(reqList)
      if (!updateRes.find(v => v.status === 'rejected')) {
        notify({
          type: 'success',
          message: t('common.actionMsg.modifiedSuccessfully'),
        })
        setShowSettingsModal(false)
      }
      else {
        notify({
          type: 'error',
          message: t('common.actionMsg.modificationFailed'),
        })
      }
      if (onRefresh)
        onRefresh()
      mutateApps()
      setUpdateLoading(false)
    },
    [app.id],
  )

  const Operations = (props: any) => {
    return <div className="w-full py-1">
      <div className={s.actionItem} onClick={(e) => {
        props?.onClose()
        onClickSettings(e)
      }}>
        <span className={s.actionName}>
          {t('common.operation.settings')}
        </span>
      </div>
      <Divider className="my-1" />
      <div
        className={cn(s.actionItem, s.deleteActionItem, 'group')}
        onClick={(e) => {
          props?.onClose()
          onClickDelete(e)
        }}
      >
        <span
          className={cn(s.actionName, 'group-hover:text-red-500')}
        >
          {t('common.operation.delete')}
        </span>
      </div>
    </div>
  }

  return (
    <>
      <Link href={`/app/${app.id}/overview`} className={style.listItem}>
        <div className={style.listItemTitle}>
          <AppIcon
            size="small"
            icon={app.icon}
            background={app.icon_background}
          />
          <div className={style.listItemHeading}>
            <div className={style.listItemHeadingContent}>{app.name}</div>
          </div>
          <CustomPopover
            htmlContent={
              <Operations />
            }
            position="br"
            btnElement={<div className={cn(s.actionIcon, s.commonIcon)} />}
            btnClassName={open =>
              cn(
                open ? '!bg-gray-100 !shadow-none' : '!bg-transparent',
                style.actionIconWrapper,
              )
            }
            className={'!w-[128px] h-fit !z-20'}
          />
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
        {showSettingsModal && (
          <AppSettings
            isShow={showSettingsModal}
            onClose={() => setShowSettingsModal(false)}
            appName={app.name}
            appIcon={{ icon: app.icon, icon_background: app.icon_background }}
            onUpdate={onUpdate}
            loading={updateLoading}
          />
        )}
      </Link>
    </>
  )
}

export default AppCard
