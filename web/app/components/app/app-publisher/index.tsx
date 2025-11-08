import {
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiBuildingLine,
  RiGlobalLine,
  RiLockLine,
  RiPlanetLine,
  RiPlayCircleLine,
  RiPlayList2Line,
  RiTerminalBoxLine,
  RiVerifiedBadgeLine,
} from '@remixicon/react'
import { useKeyPress } from 'ahooks'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '../../workflow/utils'
import Toast from '../../base/toast'
import type { ModelAndParameter } from '../configuration/debug/types'
import Divider from '../../base/divider'
import AccessControl from '../app-access-control'
import Loading from '../../base/loading'
import Tooltip from '../../base/tooltip'
import SuggestedAction from './suggested-action'
import PublishWithMultipleModel from './publish-with-multiple-model'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { basePath } from '@/utils/var'
import { fetchInstalledAppList } from '@/service/explore'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import { useStore as useAppStore } from '@/app/components/app/store'
import { CodeBrowser } from '@/app/components/base/icons/src/vender/line/development'
import WorkflowToolConfigureButton from '@/app/components/tools/workflow-tool/configure-button'
import type { InputVar } from '@/app/components/workflow/types'
import { appDefaultIconBackground } from '@/config'
import type { PublishWorkflowParams } from '@/types/workflow'
import { useAppWhiteListSubjects, useGetUserCanAccessApp } from '@/service/access-control'
import { AccessMode } from '@/models/access-control'
import { fetchAppDetailDirect } from '@/service/apps'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: (params?: any) => Promise<any> | any
  onRestore?: () => Promise<any> | any
  onToggle?: (state: boolean) => void
  crossAxisOffset?: number
  toolPublished?: boolean
  inputs?: InputVar[]
  onRefreshData?: () => void
}

const PUBLISH_SHORTCUT = ['ctrl', '⇧', 'P']

const AppPublisher = ({
  disabled = false,
  publishDisabled = false,
  publishedAt,
  draftUpdatedAt,
  debugWithMultipleModel = false,
  multipleModelConfigs = [],
  onPublish,
  onRestore,
  onToggle,
  crossAxisOffset = 0,
  toolPublished,
  inputs,
  onRefreshData,
}: AppPublisherProps) => {
  const { t } = useTranslation()
  const [published, setPublished] = useState(false)
  const [open, setOpen] = useState(false)
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}
  const appMode = (appDetail?.mode !== 'completion' && appDetail?.mode !== 'workflow') ? 'chat' : appDetail.mode
  const appURL = `${appBaseURL}${basePath}/${appMode}/${accessToken}`
  const isChatApp = ['chat', 'agent-chat', 'completion'].includes(appDetail?.mode || '')
  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp, refetch } = useGetUserCanAccessApp({ appId: appDetail?.id, enabled: false })
  const { data: appAccessSubjects, isLoading: isGettingAppWhiteListSubjects } = useAppWhiteListSubjects(appDetail?.id, open && systemFeatures.webapp_auth.enabled && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS)

  useEffect(() => {
    if (systemFeatures.webapp_auth.enabled && open && appDetail)
      refetch()
  }, [open, appDetail, refetch, systemFeatures])

  const [showAppAccessControl, setShowAppAccessControl] = useState(false)
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

  const handlePublish = useCallback(async (params?: ModelAndParameter | PublishWorkflowParams) => {
    try {
      await onPublish?.(params)
      setPublished(true)
    }
    catch {
      setPublished(false)
    }
  }, [onPublish])

  const handleRestore = useCallback(async () => {
    try {
      await onRestore?.()
      setOpen(false)
    }
    catch { }
  }, [onRestore])

  const handleTrigger = useCallback(() => {
    const state = !open

    if (disabled) {
      setOpen(false)
      return
    }

    onToggle?.(state)
    setOpen(state)

    if (state)
      setPublished(false)
  }, [disabled, onToggle, open])

  const handleOpenInExplore = useCallback(async () => {
    try {
      const { installed_apps }: any = await fetchInstalledAppList(appDetail?.id) || {}
      if (installed_apps?.length > 0)
        window.open(`${basePath}/explore/installed/${installed_apps[0].id}`, '_blank')
      else
        throw new Error('No app found in Explore')
    }
    catch (e: any) {
      Toast.notify({ type: 'error', message: `${e.message || e}` })
    }
  }, [appDetail?.id])

  const handleAccessControlUpdate = useCallback(async () => {
    if (!appDetail)
      return
    try {
      const res = await fetchAppDetailDirect({ url: '/apps', id: appDetail.id })
      setAppDetail(res)
    }
    finally {
      setShowAppAccessControl(false)
    }
  }, [appDetail, setAppDetail])

  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false)

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (e) => {
    e.preventDefault()
    if (publishDisabled || published)
      return
    handlePublish()
  }, { exactMatch: true, useCapture: true })

  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-end'
        offset={{
          mainAxis: 4,
          crossAxis: crossAxisOffset,
        }}
      >
        <PortalToFollowElemTrigger onClick={handleTrigger}>
          <Button
            variant='primary'
            className='p-2'
            disabled={disabled}
          >
            {t('workflow.common.publish')}
            <RiArrowDownSLine className='h-4 w-4 text-components-button-primary-text' />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[11]'>
          <div className='w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5'>
            <div className='p-4 pt-3'>
              <div className='system-xs-medium-uppercase flex h-6 items-center text-text-tertiary'>
                {publishedAt ? t('workflow.common.latestPublished') : t('workflow.common.currentDraftUnpublished')}
              </div>
              {publishedAt
                ? (
                  <div className='flex items-center justify-between'>
                    <div className='system-sm-medium flex items-center text-text-secondary'>
                      {t('workflow.common.publishedAt')} {formatTimeFromNow(publishedAt)}
                    </div>
                    {isChatApp && <Button
                      variant='secondary-accent'
                      size='small'
                      onClick={handleRestore}
                      disabled={published}
                    >
                      {t('workflow.common.restore')}
                    </Button>}
                  </div>
                )
                : (
                  <div className='system-sm-medium flex items-center text-text-secondary'>
                    {t('workflow.common.autoSaved')} · {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
                  </div>
                )}
              {debugWithMultipleModel
                ? (
                  <PublishWithMultipleModel
                    multipleModelConfigs={multipleModelConfigs}
                    onSelect={item => handlePublish(item)}
                  // textGenerationModelList={textGenerationModelList}
                  />
                )
                : (
                  <Button
                    variant='primary'
                    className='mt-3 w-full'
                    onClick={() => handlePublish()}
                    disabled={publishDisabled || published}
                  >
                    {
                      published
                        ? t('workflow.common.published')
                        : (
                          <div className='flex gap-1'>
                            <span>{t('workflow.common.publishUpdate')}</span>
                            <div className='flex gap-0.5'>
                              {PUBLISH_SHORTCUT.map(key => (
                                <span key={key} className='system-kbd h-4 w-4 rounded-[4px] bg-components-kbd-bg-white text-text-primary-on-surface'>
                                  {getKeyboardKeyNameBySystem(key)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                    }
                  </Button>
                )
              }
            </div>
            {(systemFeatures.webapp_auth.enabled && (isGettingUserCanAccessApp || isGettingAppWhiteListSubjects))
              ? <div className='py-2'><Loading /></div>
              : <>
                <Divider className='my-0' />
                {systemFeatures.webapp_auth.enabled && <div className='p-4 pt-3'>
                  <div className='flex h-6 items-center'>
                    <p className='system-xs-medium text-text-tertiary'>{t('app.publishApp.title')}</p>
                  </div>
                  <div className='flex h-8 cursor-pointer items-center gap-x-0.5  rounded-lg bg-components-input-bg-normal py-1 pl-2.5 pr-2 hover:bg-primary-50 hover:text-text-accent'
                    onClick={() => {
                      setShowAppAccessControl(true)
                    }}>
                    <div className='flex grow items-center gap-x-1.5 overflow-hidden pr-1'>
                      {appDetail?.access_mode === AccessMode.ORGANIZATION
                        && <>
                          <RiBuildingLine className='h-4 w-4 shrink-0 text-text-secondary' />
                          <p className='system-sm-medium text-text-secondary'>{t('app.accessControlDialog.accessItems.organization')}</p>
                        </>
                      }
                      {appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS
                        && <>
                          <RiLockLine className='h-4 w-4 shrink-0 text-text-secondary' />
                          <div className='grow truncate'>
                            <span className='system-sm-medium text-text-secondary'>{t('app.accessControlDialog.accessItems.specific')}</span>
                          </div>
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
                      }
                    </div>
                    {!isAppAccessSet && <p className='system-xs-regular shrink-0 text-text-tertiary'>{t('app.publishApp.notSet')}</p>}
                    <div className='flex h-4 w-4 shrink-0 items-center justify-center'>
                      <RiArrowRightSLine className='h-4 w-4 text-text-quaternary' />
                    </div>
                  </div>
                  {!isAppAccessSet && <p className='system-xs-regular mt-1 text-text-warning'>{t('app.publishApp.notSetDesc')}</p>}
                </div>}
                <div className='flex flex-col gap-y-1 border-t-[0.5px] border-t-divider-regular p-4 pt-3'>
                  <Tooltip triggerClassName='flex' disabled={!systemFeatures.webapp_auth.enabled || appDetail?.access_mode === AccessMode.EXTERNAL_MEMBERS || userCanAccessApp?.result} popupContent={t('app.noAccessPermission')} asChild={false}>
                    <SuggestedAction
                      className='flex-1'
                      disabled={!publishedAt || (systemFeatures.webapp_auth.enabled && appDetail?.access_mode !== AccessMode.EXTERNAL_MEMBERS && !userCanAccessApp?.result)}
                      link={appURL}
                      icon={<RiPlayCircleLine className='h-4 w-4' />}
                    >
                      {t('workflow.common.runApp')}
                    </SuggestedAction>
                  </Tooltip>
                  {appDetail?.mode === 'workflow' || appDetail?.mode === 'completion'
                    ? (
                      <Tooltip triggerClassName='flex' disabled={!systemFeatures.webapp_auth.enabled || appDetail.access_mode === AccessMode.EXTERNAL_MEMBERS || userCanAccessApp?.result} popupContent={t('app.noAccessPermission')} asChild={false}>
                        <SuggestedAction
                          className='flex-1'
                          disabled={!publishedAt || (systemFeatures.webapp_auth.enabled && appDetail.access_mode !== AccessMode.EXTERNAL_MEMBERS && !userCanAccessApp?.result)}
                          link={`${appURL}${appURL.includes('?') ? '&' : '?'}mode=batch`}
                          icon={<RiPlayList2Line className='h-4 w-4' />}
                        >
                          {t('workflow.common.batchRunApp')}
                        </SuggestedAction>
                      </Tooltip>
                    )
                    : (
                      <SuggestedAction
                        onClick={() => {
                          setEmbeddingModalOpen(true)
                          handleTrigger()
                        }}
                        disabled={!publishedAt}
                        icon={<CodeBrowser className='h-4 w-4' />}
                      >
                        {t('workflow.common.embedIntoSite')}
                      </SuggestedAction>
                    )}
                  <Tooltip triggerClassName='flex' disabled={!systemFeatures.webapp_auth.enabled || userCanAccessApp?.result} popupContent={t('app.noAccessPermission')} asChild={false}>
                    <SuggestedAction
                      className='flex-1'
                      onClick={() => {
                        if (publishedAt)
                          handleOpenInExplore()
                      }}
                      disabled={!publishedAt || (systemFeatures.webapp_auth.enabled && !userCanAccessApp?.result)}
                      icon={<RiPlanetLine className='h-4 w-4' />}
                    >
                      {t('workflow.common.openInExplore')}
                    </SuggestedAction>
                  </Tooltip>
                  <SuggestedAction
                    disabled={!publishedAt}
                    link='./develop'
                    icon={<RiTerminalBoxLine className='h-4 w-4' />}
                  >
                    {t('workflow.common.accessAPIReference')}
                  </SuggestedAction>
                  {appDetail?.mode === 'workflow' && (
                    <WorkflowToolConfigureButton
                      disabled={!publishedAt}
                      published={!!toolPublished}
                      detailNeedUpdate={!!toolPublished && published}
                      workflowAppId={appDetail?.id}
                      icon={{
                        content: (appDetail.icon_type === 'image' ? '🤖' : appDetail?.icon) || '🤖',
                        background: (appDetail.icon_type === 'image' ? appDefaultIconBackground : appDetail?.icon_background) || appDefaultIconBackground,
                      }}
                      name={appDetail?.name}
                      description={appDetail?.description}
                      inputs={inputs}
                      handlePublish={handlePublish}
                      onRefreshData={onRefreshData}
                    />
                  )}
                </div>
              </>}
          </div>
        </PortalToFollowElemContent>
        <EmbeddedModal
          siteInfo={appDetail?.site}
          isShow={embeddingModalOpen}
          onClose={() => setEmbeddingModalOpen(false)}
          appBaseUrl={appBaseURL}
          accessToken={accessToken}
        />
        {showAppAccessControl && <AccessControl app={appDetail!} onConfirm={handleAccessControlUpdate} onClose={() => { setShowAppAccessControl(false) }} />}
      </PortalToFollowElem >
    </>)
}

export default memo(AppPublisher)
