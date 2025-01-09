'use client'
import type { HTMLProps } from 'react'
import React, { useMemo, useState } from 'react'
import {
  RiLoopLeftLine,
} from '@remixicon/react'
import {
  Cog8ToothIcon,
  DocumentTextIcon,
  PaintBrushIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import SettingsModal from './settings'
import EmbeddedModal from './embedded'
import CustomizeModal from './customize'
import style from './style.module.css'
import type { ConfigParams } from './settings'
import Tooltip from '@/app/components/base/tooltip'
import AppBasic from '@/app/components/app-sidebar/basic'
import { asyncRunSafe } from '@/utils'
import Button from '@/app/components/base/button'
import Tag from '@/app/components/base/tag'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import CopyFeedback from '@/app/components/base/copy-feedback'
import ActionButton from '@/app/components/base/action-button'
import Confirm from '@/app/components/base/confirm'
import ShareQRCode from '@/app/components/base/qrcode'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'
import type { AppDetailResponse } from '@/models/app'
import { useAppContext } from '@/context/app-context'
import type { AppSSO } from '@/types/app'
import cn from '@/utils/classnames'

export type IAppCardProps = {
  className?: string
  appInfo: AppDetailResponse & Partial<AppSSO>
  cardType?: 'api' | 'webapp'
  onChangeStatus: (val: boolean) => Promise<void>
  onSaveSiteConfig?: (params: ConfigParams) => Promise<void>
  onGenerateCode?: () => Promise<void>
}

const EmbedIcon = ({ className = '' }: HTMLProps<HTMLDivElement>) => {
  return <div className={`${style.codeBrowserIcon} ${className}`}></div>
}

function AppCard({
  appInfo,
  cardType = 'webapp',
  onChangeStatus,
  onSaveSiteConfig,
  onGenerateCode,
  className,
}: IAppCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceEditor } = useAppContext()
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showEmbedded, setShowEmbedded] = useState(false)
  const [showCustomizeModal, setShowCustomizeModal] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  const { t } = useTranslation()

  const OPERATIONS_MAP = useMemo(() => {
    const operationsMap = {
      webapp: [
        { opName: t('appOverview.overview.appInfo.preview'), opIcon: RocketLaunchIcon },
        { opName: t('appOverview.overview.appInfo.customize.entry'), opIcon: PaintBrushIcon },
      ] as { opName: string; opIcon: any }[],
      api: [{ opName: t('appOverview.overview.apiInfo.doc'), opIcon: DocumentTextIcon }],
      app: [],
    }
    if (appInfo.mode !== 'completion' && appInfo.mode !== 'workflow')
      operationsMap.webapp.push({ opName: t('appOverview.overview.appInfo.embedded.entry'), opIcon: EmbedIcon })

    if (isCurrentWorkspaceEditor)
      operationsMap.webapp.push({ opName: t('appOverview.overview.appInfo.settings.entry'), opIcon: Cog8ToothIcon })

    return operationsMap
  }, [isCurrentWorkspaceEditor, appInfo, t])

  const isApp = cardType === 'webapp'
  const basicName = isApp
    ? appInfo?.site?.title
    : t('appOverview.overview.apiInfo.title')
  const toggleDisabled = isApp ? !isCurrentWorkspaceEditor : !isCurrentWorkspaceManager
  const runningStatus = isApp ? appInfo.enable_site : appInfo.enable_api
  const { app_base_url, access_token } = appInfo.site ?? {}
  const appMode = (appInfo.mode !== 'completion' && appInfo.mode !== 'workflow') ? 'chat' : appInfo.mode
  const appUrl = `${app_base_url}/${appMode}/${access_token}`
  const apiUrl = appInfo?.api_base_url

  const genClickFuncByName = (opName: string) => {
    switch (opName) {
      case t('appOverview.overview.appInfo.preview'):
        return () => {
          window.open(appUrl, '_blank')
        }
      case t('appOverview.overview.appInfo.customize.entry'):
        return () => {
          setShowCustomizeModal(true)
        }
      case t('appOverview.overview.appInfo.settings.entry'):
        return () => {
          setShowSettingsModal(true)
        }
      case t('appOverview.overview.appInfo.embedded.entry'):
        return () => {
          setShowEmbedded(true)
        }
      default:
        // jump to page develop
        return () => {
          const pathSegments = pathname.split('/')
          pathSegments.pop()
          router.push(`${pathSegments.join('/')}/develop`)
        }
    }
  }

  const onGenCode = async () => {
    if (onGenerateCode) {
      setGenLoading(true)
      await asyncRunSafe(onGenerateCode())
      setGenLoading(false)
    }
  }

  return (
    <div className={cn('rounded-xl border-effects-highlight border-t border-l-[0.5px] bg-background-default', className)}>
      <div className={cn('px-6 py-5')}>
        <div className="mb-2.5 flex flex-row items-start justify-between">
          <AppBasic
            iconType={cardType}
            icon={appInfo.icon}
            icon_background={appInfo.icon_background}
            name={basicName}
            type={
              isApp
                ? t('appOverview.overview.appInfo.explanation')
                : t('appOverview.overview.apiInfo.explanation')
            }
          />
          <div className="flex flex-row items-center h-9">
            <Tag className="mr-2" color={runningStatus ? 'green' : 'yellow'}>
              {runningStatus
                ? t('appOverview.overview.status.running')
                : t('appOverview.overview.status.disable')}
            </Tag>
            <Switch defaultValue={runningStatus} onChange={onChangeStatus} disabled={toggleDisabled} />
          </div>
        </div>
        <div className="flex flex-col justify-center py-2">
          <div className="py-1">
            <div className="pb-1 text-xs text-text-tertiary">
              {isApp
                ? t('appOverview.overview.appInfo.accessibleAddress')
                : t('appOverview.overview.apiInfo.accessibleAddress')}
            </div>
            <div className="w-full h-9 px-2 py-0.5 bg-components-input-bg-normal  rounded-lg justify-start items-center inline-flex">
              <div className="h-4 px-2 justify-start items-start gap-2 flex flex-1 min-w-0">
                <div className="text-text-secondary system-xs-medium truncate">
                  {isApp ? appUrl : apiUrl}
                </div>
              </div>
              <Divider type="vertical" className="!h-3.5 shrink-0" />
              {isApp && <ShareQRCode content={isApp ? appUrl : apiUrl} />}
              <CopyFeedback content={isApp ? appUrl : apiUrl}/>
              {/* button copy link/ button regenerate */}
              {showConfirmDelete && (
                <Confirm
                  type='warning'
                  title={t('appOverview.overview.appInfo.regenerate')}
                  content={t('appOverview.overview.appInfo.regenerateNotice')}
                  isShow={showConfirmDelete}
                  onConfirm={() => {
                    onGenCode()
                    setShowConfirmDelete(false)
                  }}
                  onCancel={() => setShowConfirmDelete(false)}
                />
              )}
              {isApp && isCurrentWorkspaceManager && (
                <Tooltip
                  popupContent={t('appOverview.overview.appInfo.regenerate') || ''}
                >
                  <ActionButton onClick={() => setShowConfirmDelete(true)}>
                    <RiLoopLeftLine className={cn('w-4 h-4', genLoading && 'animate-spin')} />
                  </ActionButton>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <div className={'pt-2 flex flex-row items-center flex-wrap gap-y-2'}>
          {!isApp && <SecretKeyButton className='shrink-0 !h-8 mr-2' textCls='!text-text-secondary font-medium' iconCls='stroke-[1.2px]' appId={appInfo.id} />}
          {OPERATIONS_MAP[cardType].map((op) => {
            const disabled
              = op.opName === t('appOverview.overview.appInfo.settings.entry')
                ? false
                : !runningStatus
            return (
              <Button
                className="mr-2"
                key={op.opName}
                onClick={genClickFuncByName(op.opName)}
                disabled={disabled}
              >
                <Tooltip
                  popupContent={
                    t('appOverview.overview.appInfo.preUseReminder') ?? ''
                  }
                  popupClassName={disabled ? 'mt-[-8px]' : '!hidden'}
                >
                  <div className="flex flex-row items-center">
                    <op.opIcon className="h-4 w-4 mr-1.5 stroke-[1.8px]" />
                    <span className="text-[13px]">{op.opName}</span>
                  </div>
                </Tooltip>
              </Button>
            )
          })}
        </div>
      </div>
      {isApp
        ? (
          <>
            <SettingsModal
              isChat={appMode === 'chat'}
              appInfo={appInfo}
              isShow={showSettingsModal}
              onClose={() => setShowSettingsModal(false)}
              onSave={onSaveSiteConfig}
            />
            <EmbeddedModal
              siteInfo={appInfo.site}
              isShow={showEmbedded}
              onClose={() => setShowEmbedded(false)}
              appBaseUrl={app_base_url}
              accessToken={access_token}
            />
            <CustomizeModal
              isShow={showCustomizeModal}
              linkUrl=""
              onClose={() => setShowCustomizeModal(false)}
              appId={appInfo.id}
              api_base_url={appInfo.api_base_url}
              mode={appInfo.mode}
            />
          </>
        )
        : null}
    </div>
  )
}

export default AppCard
