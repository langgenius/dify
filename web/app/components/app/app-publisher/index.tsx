import type { ModelAndParameter } from '../configuration/debug/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
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
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Button } from '@/app/components/base/ui/button'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects, useGetUserCanAccessApp } from '@/service/access-control'
import { fetchAppDetailDirect } from '@/service/apps'
import { fetchInstalledAppList } from '@/service/explore'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { toast } from '../../base/ui/toast'
import { getKeyboardKeyCodeBySystem } from '../../workflow/utils'
import AccessControl from '../app-access-control'
import {
  PublisherAccessSection,
  PublisherActionsSection,
  PublisherSummarySection,
} from './sections'
import {
  getDisabledFunctionTooltip,
  getPublisherAppUrl,
  isPublisherAccessConfigured,
} from './utils'

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
  hasHumanInputNode?: boolean
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
  hasHumanInputNode = false,
}: AppPublisherProps) => {
  const { t } = useTranslation()

  const [published, setPublished] = useState(false)
  const [open, setOpen] = useState(false)
  const [showAppAccessControl, setShowAppAccessControl] = useState(false)

  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false)

  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}

  const appURL = getPublisherAppUrl({ appBaseUrl: appBaseURL, accessToken, mode: appDetail?.mode })
  const isChatApp = [AppModeEnum.CHAT, AppModeEnum.AGENT_CHAT, AppModeEnum.COMPLETION].includes(appDetail?.mode || AppModeEnum.CHAT)

  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp, refetch } = useGetUserCanAccessApp({ appId: appDetail?.id, enabled: false })
  const { data: appAccessSubjects, isLoading: isGettingAppWhiteListSubjects } = useAppWhiteListSubjects(appDetail?.id, open && systemFeatures.webapp_auth.enabled && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS)
  const openAsyncWindow = useAsyncWindowOpen()

  const isAppAccessSet = useMemo(() => isPublisherAccessConfigured(appDetail, appAccessSubjects), [appAccessSubjects, appDetail])

  const noAccessPermission = useMemo(() => Boolean(
    systemFeatures.webapp_auth.enabled
    && appDetail
    && appDetail.access_mode !== AccessMode.EXTERNAL_MEMBERS
    && !userCanAccessApp?.result,
  ), [systemFeatures, appDetail, userCanAccessApp])
  const disabledFunctionButton = useMemo(() => (!publishedAt || missingStartNode || noAccessPermission), [publishedAt, missingStartNode, noAccessPermission])
  const disabledFunctionTooltip = useMemo(() => getDisabledFunctionTooltip({
    t,
    publishedAt,
    missingStartNode,
    noAccessPermission,
  }), [missingStartNode, noAccessPermission, publishedAt, t])

  useEffect(() => {
    if (systemFeatures.webapp_auth.enabled && open && appDetail)
      refetch()
  }, [open, appDetail, refetch, systemFeatures])

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
      const { installed_apps } = await fetchInstalledAppList(appDetail.id)
      if (installed_apps?.length > 0)
        return `${basePath}/explore/installed/${installed_apps[0].id}`
      throw new Error('No app found in Explore')
    }, {
      onError: (err) => {
        toast.error(`${err.message || err}`)
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
  const workflowToolMessage = !hasPublishedVersion || !workflowToolAvailable
    ? t('common.workflowAsToolDisabledHint', { ns: 'workflow' })
    : undefined
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
            className="py-2 pr-2 pl-3"
            disabled={disabled}
          >
            {t('common.publish', { ns: 'workflow' })}
            <span className="i-ri-arrow-down-s-line h-4 w-4 text-components-button-primary-text" />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-11">
          <div className="w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
            <PublisherSummarySection
              debugWithMultipleModel={debugWithMultipleModel}
              draftUpdatedAt={draftUpdatedAt}
              formatTimeFromNow={formatTimeFromNow}
              handlePublish={handlePublish}
              handleRestore={handleRestore}
              isChatApp={isChatApp}
              multipleModelConfigs={multipleModelConfigs}
              publishDisabled={publishDisabled}
              published={published}
              publishedAt={publishedAt}
              publishShortcut={PUBLISH_SHORTCUT}
              startNodeLimitExceeded={startNodeLimitExceeded}
              upgradeHighlightStyle={upgradeHighlightStyle}
            />
            <PublisherAccessSection
              enabled={systemFeatures.webapp_auth.enabled}
              isAppAccessSet={isAppAccessSet}
              isLoading={Boolean(systemFeatures.webapp_auth.enabled && (isGettingUserCanAccessApp || isGettingAppWhiteListSubjects))}
              accessMode={appDetail?.access_mode}
              onClick={() => setShowAppAccessControl(true)}
            />
            <PublisherActionsSection
              appDetail={appDetail}
              appURL={appURL}
              disabledFunctionButton={disabledFunctionButton}
              disabledFunctionTooltip={disabledFunctionTooltip}
              handleEmbed={() => {
                setEmbeddingModalOpen(true)
                handleTrigger()
              }}
              handleOpenInExplore={handleOpenInExplore}
              handlePublish={handlePublish}
              hasHumanInputNode={hasHumanInputNode}
              hasTriggerNode={hasTriggerNode}
              inputs={inputs}
              missingStartNode={missingStartNode}
              onRefreshData={onRefreshData}
              outputs={outputs}
              published={published}
              publishedAt={publishedAt}
              toolPublished={toolPublished}
              workflowToolAvailable={workflowToolAvailable}
              workflowToolMessage={workflowToolMessage}
            />
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
