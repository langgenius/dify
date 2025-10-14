'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  RiBookOpenLine,
  RiBuildingLine,
  RiEqualizer2Line,
  RiExternalLinkLine,
  RiGlobalLine,
  RiLockLine,
  RiPaintBrushLine,
  RiVerifiedBadgeLine,
  RiWindowLine,
} from '@remixicon/react'
import SettingsModal from './settings'
import EmbeddedModal from './embedded'
import CustomizeModal from './customize'
import style from './style.module.css'
import type { ConfigParams } from './settings'
import Tooltip from '@/app/components/base/tooltip'
import AppBasic from '@/app/components/app-sidebar/basic'
import { asyncRunSafe } from '@/utils'
import { basePath } from '@/utils/var'
import { useStore as useAppStore } from '@/app/components/app/store'
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
import { fetchAppDetailDirect } from '@/service/apps'
import { AccessMode } from '@/models/access-control'
import AccessControl from '../app-access-control'
import { useAppWhiteListSubjects } from '@/service/access-control'
import { useGlobalPublicStore } from '@/context/global-public-context'

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
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showEmbedded, setShowEmbedded] = useState(false)
  const [showCustomizeModal, setShowCustomizeModal] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showAccessControl, setShowAccessControl] = useState<boolean>(false)
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { data: appAccessSubjects } = useAppWhiteListSubjects(appDetail?.id, systemFeatures.webapp_auth.enabled && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS)

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
  const appUrl = `${app_base_url}${basePath}/${appMode}/${access_token}`
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

  const [isAppAccessSet, setIsAppAccessSet] = useState(true)
  useEffect(() => {
    if (appDetail && appAccessSubjects) {
      if (appDetail.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS && appAccessSubjects.groups?.length === 0 && appAccessSubjects.members?.length === 0)
        setIsAppAccessSet(false)
      else
        setIsAppAccessSet(true)
    }
    else {
      setIsAppAccessSet(true)
    }
  }, [appAccessSubjects, appDetail])

  const handleClickAccessControl = useCallback(() => {
    if (!appDetail)
      return
    setShowAccessControl(true)
  }, [appDetail])
  const handleAccessControlUpdate = useCallback(async () => {
    try {
      const res = await fetchAppDetailDirect({ url: '/apps', id: appDetail!.id })
      setAppDetail(res)
      setShowAccessControl(false)
    }
    catch (error) {
      console.error('Failed to fetch app detail:', error)
    }
  }, [appDetail, setAppDetail])

  return (
    <div
      className={
        `${isInPanel ? 'border-l-[0.5px] border-t' : 'border-[0.5px] shadow-xs'} w-full max-w-full rounded-xl border-effects-highlight ${className ?? ''}`}
    >
      <div className={`${customBgColor ?? 'bg-background-default'} rounded-xl`}>
        <div className='flex w-full flex-col items-start justify-center gap-3 self-stretch border-b-[0.5px] border-divider-subtle p-3'>
          <div className='flex w-full items-center gap-3 self-stretch'>
            <AppBasic
              iconType={cardType}
              icon={appInfo.icon}
              icon_background={appInfo.icon_background}
              name={basicName}
              hideType
              type={
                isApp
                  ? t('appOverview.overview.appInfo.explanation')
                  : t('appOverview.overview.apiInfo.explanation')
              }
            />
            <div className='flex shrink-0 items-center gap-1'>
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
            <div className="system-xs-medium pb-1 text-text-tertiary">
              {isApp
                ? t('appOverview.overview.appInfo.accessibleAddress')
                : t('appOverview.overview.apiInfo.accessibleAddress')}
            </div>
            <div className="inline-flex h-9 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
              <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-text-secondary">
                  {isApp ? appUrl : apiUrl}
                </div>
              </div>
              <CopyFeedback
                content={isApp ? appUrl : apiUrl}
                className={'!size-6'}
              />
              {isApp && <ShareQRCode content={isApp ? appUrl : apiUrl} />}
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
                    className="h-6 w-6 cursor-pointer rounded-md hover:bg-state-base-hover"
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
          {isApp && systemFeatures.webapp_auth.enabled && appDetail && <div className='flex flex-col items-start justify-center self-stretch'>
            <div className="system-xs-medium pb-1 text-text-tertiary">{t('app.publishApp.title')}</div>
            <div className='flex h-9 w-full cursor-pointer items-center gap-x-0.5  rounded-lg bg-components-input-bg-normal py-1 pl-2.5 pr-2'
              onClick={handleClickAccessControl}>
              <div className='flex grow items-center gap-x-1.5 pr-1'>
                {appDetail?.access_mode === AccessMode.ORGANIZATION
                  && <>
                    <RiBuildingLine className='h-4 w-4 shrink-0 text-text-secondary' />
                    <p className='system-sm-medium text-text-secondary'>{t('app.accessControlDialog.accessItems.organization')}</p>
                  </>
                }
                {appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS
                  && <>
                    <RiLockLine className='h-4 w-4 shrink-0 text-text-secondary' />
                    <p className='system-sm-medium text-text-secondary'>{t('app.accessControlDialog.accessItems.specific')}</p>
                  </>
                }
                {appDetail?.access_mode === AccessMode.PUBLIC
                  && <>
                    <RiGlobalLine className='h-4 w-4 shrink-0 text-text-secondary' />
                    <p className='system-sm-medium text-text-secondary'>{t('app.accessControlDialog.accessItems.anyone')}</p>
                  </>
                }
                {appDetail?.access_mode === AccessMode.EXTERNAL_MEMBERS
                  && <>
                    <RiVerifiedBadgeLine className='h-4 w-4 shrink-0 text-text-secondary' />
                    <p className='system-sm-medium text-text-secondary'>{t('app.accessControlDialog.accessItems.external')}</p>
                  </>
                }</div>
              {!isAppAccessSet && <p className='system-xs-regular shrink-0 text-text-tertiary'>{t('app.publishApp.notSet')}</p>}
              <div className='flex h-4 w-4 shrink-0 items-center justify-center'>
                <RiArrowRightSLine className='h-4 w-4 text-text-quaternary' />
              </div>
            </div>
          </div>}
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
                    <div className={`${(runningStatus || !disabled) ? 'text-text-tertiary' : 'text-components-button-ghost-text-disabled'} system-xs-medium px-[3px]`}>{op.opName}</div>
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
            {
              showAccessControl && <AccessControl app={appDetail!}
                onConfirm={handleAccessControlUpdate}
                onClose={() => { setShowAccessControl(false) }} />
            }
          </>
        )
        : null}
    </div>
  )
}

export default AppCard
