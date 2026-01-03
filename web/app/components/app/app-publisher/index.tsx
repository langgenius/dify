import type { ModelAndParameter } from '../configuration/debug/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { I18nKeysByPrefix } from '@/types/i18n'
import type { PublishWorkflowParams } from '@/types/workflow'
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
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import { useStore as useAppStore } from '@/app/components/app/store'
import { trackEvent } from '@/app/components/base/amplitude'
import Button from '@/app/components/base/button'
import { CodeBrowser } from '@/app/components/base/icons/src/vender/line/development'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import WorkflowToolConfigureButton from '@/app/components/tools/workflow-tool/configure-button'
import { appDefaultIconBackground } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects, useGetUserCanAccessApp } from '@/service/access-control'
import { fetchAppDetailDirect } from '@/service/apps'
import { fetchInstalledAppList } from '@/service/explore'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import Divider from '../../base/divider'
import Loading from '../../base/loading'
import Toast from '../../base/toast'
import Tooltip from '../../base/tooltip'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '../../workflow/utils'
import AccessControl from '../app-access-control'
import PublishWithMultipleModel from './publish-with-multiple-model'
import SuggestedAction from './suggested-action'

type AccessModeLabel = I18nKeysByPrefix<'app', 'accessControlDialog.accessItems.'>

const ACCESS_MODE_MAP: Record<AccessMode, { label: AccessModeLabel, icon: React.ElementType }> = {
  [AccessMode.ORGANIZATION]: {
    label: 'organization',
    icon: RiBuildingLine,
  },
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: {
    label: 'specific',
    icon: RiLockLine,
  },
  [AccessMode.PUBLIC]: {
    label: 'anyone',
    icon: RiGlobalLine,
  },
  [AccessMode.EXTERNAL_MEMBERS]: {
    label: 'external',
    icon: RiVerifiedBadgeLine,
  },
}

const AccessModeDisplay: React.FC<{ mode?: AccessMode }> = ({ mode }) => {
  const { t } = useTranslation()

  if (!mode || !ACCESS_MODE_MAP[mode])
    return null

  const { icon: Icon, label } = ACCESS_MODE_MAP[mode]

  return (
    <>
      <Icon className="h-4 w-4 shrink-0 text-text-secondary" />
      <div className="grow truncate">
        <span className="system-sm-medium text-text-secondary">{t(`accessControlDialog.accessItems.${label}`, { ns: 'app' })}</span>
      </div>
    </>
  )
}

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
  outputs?: Variable[]
  onRefreshData?: () => void
  workflowToolAvailable?: boolean
  missingStartNode?: boolean
  hasTriggerNode?: boolean // Whether workflow currently contains any trigger nodes (used to hide missing-start CTA when triggers exist).
  startNodeLimitExceeded?: boolean
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
  outputs,
  onRefreshData,
  workflowToolAvailable = true,
  missingStartNode = false,
  hasTriggerNode = false,
  startNodeLimitExceeded = false,
}: AppPublisherProps) => {
  const { t } = useTranslation()

  const [published, setPublished] = useState(false)
  const [open, setOpen] = useState(false)
  const [showAppAccessControl, setShowAppAccessControl] = useState(false)
  const [isAppAccessSet, setIsAppAccessSet] = useState(true)
  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false)

  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}

  const appMode = (appDetail?.mode !== AppModeEnum.COMPLETION && appDetail?.mode !== AppModeEnum.WORKFLOW) ? AppModeEnum.CHAT : appDetail.mode
  const appURL = `${appBaseURL}${basePath}/${appMode}/${accessToken}`
  const isChatApp = [AppModeEnum.CHAT, AppModeEnum.AGENT_CHAT, AppModeEnum.COMPLETION].includes(appDetail?.mode || AppModeEnum.CHAT)

  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp, refetch } = useGetUserCanAccessApp({ appId: appDetail?.id, enabled: false })
  const { data: appAccessSubjects, isLoading: isGettingAppWhiteListSubjects } = useAppWhiteListSubjects(appDetail?.id, open && systemFeatures.webapp_auth.enabled && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS)
  const openAsyncWindow = useAsyncWindowOpen()

  const noAccessPermission = useMemo(() => systemFeatures.webapp_auth.enabled && appDetail && appDetail.access_mode !== AccessMode.EXTERNAL_MEMBERS && !userCanAccessApp?.result, [systemFeatures, appDetail, userCanAccessApp])
  const disabledFunctionButton = useMemo(() => (!publishedAt || missingStartNode || noAccessPermission), [publishedAt, missingStartNode, noAccessPermission])

  const disabledFunctionTooltip = useMemo(() => {
    if (!publishedAt)
      return t('notPublishedYet', { ns: 'app' })
    if (missingStartNode)
      return t('noUserInputNode', { ns: 'app' })
    if (noAccessPermission)
      return t('noAccessPermission', { ns: 'app' })
  }, [missingStartNode, noAccessPermission, publishedAt])

  useEffect(() => {
    if (systemFeatures.webapp_auth.enabled && open && appDetail)
      refetch()
  }, [open, appDetail, refetch, systemFeatures])

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
      trackEvent('app_published_time', { action_mode: 'app', app_id: appDetail?.id, app_name: appDetail?.name })
    }
    catch {
      setPublished(false)
    }
  }, [appDetail, onPublish])

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
    await openAsyncWindow(async () => {
      if (!appDetail?.id)
        throw new Error('App not found')
      const { installed_apps }: any = await fetchInstalledAppList(appDetail?.id) || {}
      if (installed_apps?.length > 0)
        return `${basePath}/explore/installed/${installed_apps[0].id}`
      throw new Error('No app found in Explore')
    }, {
      onError: (err) => {
        Toast.notify({ type: 'error', message: `${err.message || err}` })
      },
    })
  }, [appDetail?.id, openAsyncWindow])

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

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (e) => {
    e.preventDefault()
    if (publishDisabled || published)
      return
    handlePublish()
  }, { exactMatch: true, useCapture: true })

  const hasPublishedVersion = !!publishedAt
  const workflowToolDisabled = !hasPublishedVersion || !workflowToolAvailable
  const workflowToolMessage = workflowToolDisabled ? t('common.workflowAsToolDisabledHint', { ns: 'workflow' }) : undefined
  const showStartNodeLimitHint = Boolean(startNodeLimitExceeded)
  const upgradeHighlightStyle = useMemo(() => ({
    background: 'linear-gradient(97deg, var(--components-input-border-active-prompt-1, rgba(11, 165, 236, 0.95)) -3.64%, var(--components-input-border-active-prompt-2, rgba(21, 90, 239, 0.95)) 45.14%)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  }), [])

  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        offset={{
          mainAxis: 4,
          crossAxis: crossAxisOffset,
        }}
      >
        <PortalToFollowElemTrigger onClick={handleTrigger}>
          <Button
            variant="primary"
            className="py-2 pl-3 pr-2"
            disabled={disabled}
          >
            {t('common.publish', { ns: 'workflow' })}
            <RiArrowDownSLine className="h-4 w-4 text-components-button-primary-text" />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[11]">
          <div className="w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
            <div className="p-4 pt-3">
              <div className="system-xs-medium-uppercase flex h-6 items-center text-text-tertiary">
                {publishedAt ? t('common.latestPublished', { ns: 'workflow' }) : t('common.currentDraftUnpublished', { ns: 'workflow' })}
              </div>
              {publishedAt
                ? (
                    <div className="flex items-center justify-between">
                      <div className="system-sm-medium flex items-center text-text-secondary">
                        {t('common.publishedAt', { ns: 'workflow' })}
                        {' '}
                        {formatTimeFromNow(publishedAt)}
                      </div>
                      {isChatApp && (
                        <Button
                          variant="secondary-accent"
                          size="small"
                          onClick={handleRestore}
                          disabled={published}
                        >
                          {t('common.restore', { ns: 'workflow' })}
                        </Button>
                      )}
                    </div>
                  )
                : (
                    <div className="system-sm-medium flex items-center text-text-secondary">
                      {t('common.autoSaved', { ns: 'workflow' })}
                      {' '}
                      ·
                      {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
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
                    <>
                      <Button
                        variant="primary"
                        className="mt-3 w-full"
                        onClick={() => handlePublish()}
                        disabled={publishDisabled || published}
                      >
                        {
                          published
                            ? t('common.published', { ns: 'workflow' })
                            : (
                                <div className="flex gap-1">
                                  <span>{t('common.publishUpdate', { ns: 'workflow' })}</span>
                                  <div className="flex gap-0.5">
                                    {PUBLISH_SHORTCUT.map(key => (
                                      <span key={key} className="system-kbd h-4 w-4 rounded-[4px] bg-components-kbd-bg-white text-text-primary-on-surface">
                                        {getKeyboardKeyNameBySystem(key)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )
                        }
                      </Button>
                      {showStartNodeLimitHint && (
                        <div className="mt-3 flex flex-col items-stretch">
                          <p
                            className="text-sm font-semibold leading-5 text-transparent"
                            style={upgradeHighlightStyle}
                          >
                            <span className="block">{t('publishLimit.startNodeTitlePrefix', { ns: 'workflow' })}</span>
                            <span className="block">{t('publishLimit.startNodeTitleSuffix', { ns: 'workflow' })}</span>
                          </p>
                          <p className="mt-1 text-xs leading-4 text-text-secondary">
                            {t('publishLimit.startNodeDesc', { ns: 'workflow' })}
                          </p>
                          <UpgradeBtn
                            isShort
                            className="mb-[12px] mt-[9px] h-[32px] w-[93px] self-start"
                          />
                        </div>
                      )}
                    </>
                  )}
            </div>
            {(systemFeatures.webapp_auth.enabled && (isGettingUserCanAccessApp || isGettingAppWhiteListSubjects))
              ? <div className="py-2"><Loading /></div>
              : (
                  <>
                    <Divider className="my-0" />
                    {systemFeatures.webapp_auth.enabled && (
                      <div className="p-4 pt-3">
                        <div className="flex h-6 items-center">
                          <p className="system-xs-medium text-text-tertiary">{t('publishApp.title', { ns: 'app' })}</p>
                        </div>
                        <div
                          className="flex h-8 cursor-pointer items-center gap-x-0.5  rounded-lg bg-components-input-bg-normal py-1 pl-2.5 pr-2 hover:bg-primary-50 hover:text-text-accent"
                          onClick={() => {
                            setShowAppAccessControl(true)
                          }}
                        >
                          <div className="flex grow items-center gap-x-1.5 overflow-hidden pr-1">
                            <AccessModeDisplay mode={appDetail?.access_mode} />
                          </div>
                          {!isAppAccessSet && <p className="system-xs-regular shrink-0 text-text-tertiary">{t('publishApp.notSet', { ns: 'app' })}</p>}
                          <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                            <RiArrowRightSLine className="h-4 w-4 text-text-quaternary" />
                          </div>
                        </div>
                        {!isAppAccessSet && <p className="system-xs-regular mt-1 text-text-warning">{t('publishApp.notSetDesc', { ns: 'app' })}</p>}
                      </div>
                    )}
                    {
                      // Hide run/batch run app buttons when there is a trigger node.
                      !hasTriggerNode && (
                        <div className="flex flex-col gap-y-1 border-t-[0.5px] border-t-divider-regular p-4 pt-3">
                          <Tooltip triggerClassName="flex" disabled={!disabledFunctionButton} popupContent={disabledFunctionTooltip} asChild={false}>
                            <SuggestedAction
                              className="flex-1"
                              disabled={disabledFunctionButton}
                              link={appURL}
                              icon={<RiPlayCircleLine className="h-4 w-4" />}
                            >
                              {t('common.runApp', { ns: 'workflow' })}
                            </SuggestedAction>
                          </Tooltip>
                          {appDetail?.mode === AppModeEnum.WORKFLOW || appDetail?.mode === AppModeEnum.COMPLETION
                            ? (
                                <Tooltip triggerClassName="flex" disabled={!disabledFunctionButton} popupContent={disabledFunctionTooltip} asChild={false}>
                                  <SuggestedAction
                                    className="flex-1"
                                    disabled={disabledFunctionButton}
                                    link={`${appURL}${appURL.includes('?') ? '&' : '?'}mode=batch`}
                                    icon={<RiPlayList2Line className="h-4 w-4" />}
                                  >
                                    {t('common.batchRunApp', { ns: 'workflow' })}
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
                                  icon={<CodeBrowser className="h-4 w-4" />}
                                >
                                  {t('common.embedIntoSite', { ns: 'workflow' })}
                                </SuggestedAction>
                              )}
                          <Tooltip triggerClassName="flex" disabled={!disabledFunctionButton} popupContent={disabledFunctionTooltip} asChild={false}>
                            <SuggestedAction
                              className="flex-1"
                              onClick={() => {
                                if (publishedAt)
                                  handleOpenInExplore()
                              }}
                              disabled={disabledFunctionButton}
                              icon={<RiPlanetLine className="h-4 w-4" />}
                            >
                              {t('common.openInExplore', { ns: 'workflow' })}
                            </SuggestedAction>
                          </Tooltip>
                          <Tooltip triggerClassName="flex" disabled={!!publishedAt && !missingStartNode} popupContent={!publishedAt ? t('notPublishedYet', { ns: 'app' }) : t('noUserInputNode', { ns: 'app' })} asChild={false}>
                            <SuggestedAction
                              className="flex-1"
                              disabled={!publishedAt || missingStartNode}
                              link="./develop"
                              icon={<RiTerminalBoxLine className="h-4 w-4" />}
                            >
                              {t('common.accessAPIReference', { ns: 'workflow' })}
                            </SuggestedAction>
                          </Tooltip>
                          {appDetail?.mode === AppModeEnum.WORKFLOW && (
                            <WorkflowToolConfigureButton
                              disabled={workflowToolDisabled}
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
                              outputs={outputs}
                              handlePublish={handlePublish}
                              onRefreshData={onRefreshData}
                              disabledReason={workflowToolMessage}
                            />
                          )}
                        </div>
                      )
                    }
                  </>
                )}
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
      </PortalToFollowElem>
    </>
  )
}

export default memo(AppPublisher)
