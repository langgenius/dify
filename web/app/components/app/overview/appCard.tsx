'use client'
import React, { useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  RiBookOpenLine,
  RiEqualizer2Line,
  RiExternalLinkLine,
  RiPaintBrushLine,
  RiWindowLine,
} from '@remixicon/react'
import SettingsModal from './settings'
import EmbeddedModal from './embedded'
import CustomizeModal from './customize'
import style from './style.module.css'
import type { ConfigParams } from './settings'
import Tooltip from '@/app/components/base/tooltip'
import AppBasic from '@/app/components/app-sidebar/basic'
import { asyncRunSafe, randomString } from '@/utils'
import Button from '@/app/components/base/button'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Confirm from '@/app/components/base/confirm'
import ShareQRCode from '@/app/components/base/qrcode'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'
import type { AppDetailResponse } from '@/models/app'
import { useAppContext } from '@/context/app-context'
import type { AppSSO } from '@/types/app'
import Indicator from '@/app/components/header/indicator'

export type IAppCardProps = {
  className?: string
  appInfo: AppDetailResponse & Partial<AppSSO>
  isInPanel?: boolean
  cardType?: 'api' | 'webapp'
  customBgColor?: string
  onChangeStatus: (val: boolean) => Promise<void>
  onSaveSiteConfig?: (params: ConfigParams) => Promise<void>
  onGenerateCode?: () => Promise<void>
}

function AppCard({
  appInfo,
  isInPanel,
  cardType = 'webapp',
  customBgColor,
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
        { opName: t('appOverview.overview.appInfo.launch'), opIcon: RiExternalLinkLine },
      ] as { opName: string; opIcon: any }[],
      api: [{ opName: t('appOverview.overview.apiInfo.doc'), opIcon: RiBookOpenLine }],
      app: [],
    }
    if (appInfo.mode !== 'completion' && appInfo.mode !== 'workflow')
      operationsMap.webapp.push({ opName: t('appOverview.overview.appInfo.embedded.entry'), opIcon: RiWindowLine })

    operationsMap.webapp.push({ opName: t('appOverview.overview.appInfo.customize.entry'), opIcon: RiPaintBrushLine })

    if (isCurrentWorkspaceEditor)
      operationsMap.webapp.push({ opName: t('appOverview.overview.appInfo.settings.entry'), opIcon: RiEqualizer2Line })

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
      case t('appOverview.overview.appInfo.launch'):
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
    <div
      className={
        `${isInPanel ? 'border-l-[0.5px] border-t' : 'shadow-xs border-[0.5px]'} border-effects-highlight w-full max-w-full rounded-xl ${className ?? ''}`}
    >
      <div className={`${customBgColor ?? 'bg-background-default'} rounded-xl`}>
        <div className='border-divider-subtle flex w-full flex-col items-start justify-center gap-3 self-stretch border-b-[0.5px] p-3'>
          <div className='flex w-full items-center gap-3 self-stretch'>
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
            <div className='flex items-center gap-1'>
              <Indicator color={runningStatus ? 'green' : 'yellow'} />
              <div className={`${runningStatus ? 'text-text-success' : 'text-text-warning'} system-xs-semibold-uppercase`}>
                {runningStatus
                  ? t('appOverview.overview.status.running')
                  : t('appOverview.overview.status.disable')}
              </div>
            </div>
            <Switch defaultValue={runningStatus} onChange={onChangeStatus} disabled={toggleDisabled} />
          </div>
          <div className='flex flex-col items-start justify-center self-stretch'>
            <div className="system-xs-medium text-text-tertiary pb-1">
              {isApp
                ? t('appOverview.overview.appInfo.accessibleAddress')
                : t('appOverview.overview.apiInfo.accessibleAddress')}
            </div>
            <div className="bg-components-input-bg-normal inline-flex h-9 w-full items-center gap-0.5 rounded-lg p-1 pl-2">
              <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
                <div className="text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">
                  {isApp ? appUrl : apiUrl}
                </div>
              </div>
              <CopyFeedback
                content={isApp ? appUrl : apiUrl}
                className={'!size-6'}
              />
              {isApp && <ShareQRCode content={isApp ? appUrl : apiUrl} className='hover:bg-state-base-hover z-50 !size-6 rounded-md' selectorId={randomString(8)} />}
              {isApp && <Divider type="vertical" className="!mx-0.5 !h-3.5 shrink-0" />}
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
                  <div
                    className="hover:bg-state-base-hover h-6 w-6 cursor-pointer rounded-md"
                    onClick={() => setShowConfirmDelete(true)}
                  >
                    <div
                      className={
                        `h-full w-full ${style.refreshIcon} ${genLoading ? style.generateLogo : ''}`}
                    ></div>
                  </div>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <div className={'flex items-center gap-1 self-stretch p-3'}>
          {!isApp && <SecretKeyButton appId={appInfo.id} />}
          {OPERATIONS_MAP[cardType].map((op) => {
            const disabled
              = op.opName === t('appOverview.overview.appInfo.settings.entry')
                ? false
                : !runningStatus
            return (
              <Button
                className="mr-1 min-w-[88px]"
                size="small"
                variant={'ghost'}
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
                  <div className="flex items-center justify-center gap-[1px]">
                    <op.opIcon className="h-3.5 w-3.5" />
                    <div className={`${runningStatus ? 'text-text-tertiary' : 'text-components-button-ghost-text-disabled'} system-xs-medium px-[3px]`}>{op.opName}</div>
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