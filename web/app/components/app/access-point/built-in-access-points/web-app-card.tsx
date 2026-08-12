'use client'

import type { SelectorParam } from 'i18next'
import type { AccessPointAvailability } from '../shared/access-point-status'
import type { AccessPointAppInfo, PublishedWorkflow } from '../shared/utils'
import type { ConfigParams } from '@/app/components/app/overview/settings'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessControl from '@/app/components/app/app-access-control'
import CustomizeModal from '@/app/components/app/overview/customize'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import SettingsModal from '@/app/components/app/overview/settings'
import { WorkflowLaunchDialog } from '@/app/components/app/overview/workflow-launch-dialog'
import AppIcon from '@/app/components/base/app-icon'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control/use-app-access-control'
import { AppModeEnum } from '@/types/app'
import { AccessPointCard } from '../shared/access-point-card'
import { getAccessPointStatus } from '../shared/access-point-status'
import { AccessPointUrl } from '../shared/access-point-url'
import { getBuiltInAccessUrls, getHiddenStartInputs } from '../shared/utils'
import { WebAppAccessControlEntry } from '../shared/web-app-access-control'

const ACCESS_MODE_ICON_MAP: Record<AccessMode, string> = {
  [AccessMode.ORGANIZATION]: 'i-ri-building-line',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'i-ri-lock-line',
  [AccessMode.PUBLIC]: 'i-ri-global-line',
  [AccessMode.EXTERNAL_MEMBERS]: 'i-ri-verified-badge-line',
}

const ACCESS_MODE_LABEL_MAP: Record<AccessMode, SelectorParam<'app'>> = {
  [AccessMode.ORGANIZATION]: ($) => $['accessControlDialog.accessItems.organization'],
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: ($) => $['accessControlDialog.accessItems.specific'],
  [AccessMode.PUBLIC]: ($) => $['accessControlDialog.accessItems.anyone'],
  [AccessMode.EXTERNAL_MEMBERS]: ($) => $['accessControlDialog.accessItems.external'],
}

type WebAppAccessPointCardProps = {
  appInfo: AccessPointAppInfo
  availability: AccessPointAvailability
  canEdit: boolean
  canDeploy: boolean
  canManageAccess: boolean
  highlighted?: boolean
  showAccessControl: boolean
  onChangeStatus: (enabled: boolean) => Promise<void>
  onRefreshApp: () => Promise<void>
  onRegenerate: () => Promise<void>
  onSaveSiteConfig: (params: ConfigParams) => Promise<void>
  workflow: PublishedWorkflow
}

export function WebAppAccessPointCard({
  appInfo,
  availability,
  canEdit,
  canDeploy,
  canManageAccess,
  highlighted,
  onChangeStatus,
  onRefreshApp,
  onRegenerate,
  onSaveSiteConfig,
  showAccessControl,
  workflow,
}: WebAppAccessPointCardProps) {
  const { t } = useTranslation()
  const [showSettings, setShowSettings] = useState(false)
  const [showEmbedded, setShowEmbedded] = useState(false)
  const [showCustomize, setShowCustomize] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [showRegenerate, setShowRegenerate] = useState(false)
  const [showWorkflowLaunch, setShowWorkflowLaunch] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const { webApp: webAppUrl } = getBuiltInAccessUrls(appInfo)
  const running = availability === 'available' && appInfo.enable_site
  const supportsEmbedded =
    appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW
  const hiddenLaunchVariables = getHiddenStartInputs(workflow)
  const accessIcon = ACCESS_MODE_ICON_MAP[appInfo.access_mode]
  const accessLabel = ACCESS_MODE_LABEL_MAP[appInfo.access_mode]
  const { data: accessSubjects } = useAppWhiteListSubjects(
    appInfo.id,
    showAccessControl &&
      canManageAccess &&
      appInfo.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  const accessConfigured =
    !accessSubjects ||
    appInfo.access_mode !== AccessMode.SPECIFIC_GROUPS_MEMBERS ||
    Boolean(accessSubjects?.groups?.length || accessSubjects?.members?.length)

  const handleRegenerate = async () => {
    setRegenerating(true)
    await onRegenerate()
    setRegenerating(false)
    setShowRegenerate(false)
  }

  const status = getAccessPointStatus(availability, running)

  return (
    <>
      <AccessPointCard
        title={t(($) => $['agentDetail.access.webApp.title'], { ns: 'agentV2' })}
        description={t(($) => $['studio.accessPoint.webAppDescription'], {
          ns: 'deployments',
        })}
        icon={
          <AppIcon
            size="large"
            iconType={appInfo.icon_type}
            icon={appInfo.icon}
            background={appInfo.icon_background}
            imageUrl={appInfo.icon_url}
          />
        }
        status={status}
        highlighted={highlighted}
        switchDisabled={!canEdit}
        switchLabel={t(($) => $['overview.appInfo.title'], { ns: 'appOverview' })}
        onEnabledChange={availability === 'available' ? onChangeStatus : undefined}
        actions={
          <>
            {hiddenLaunchVariables.length > 0 && (
              <Button
                className="flex items-center gap-1 px-3"
                variant="secondary"
                disabled={!running}
                onClick={() => setShowWorkflowLaunch(true)}
              >
                <span aria-hidden className="i-ri-settings-2-line size-4" />
                {t(($) => $['operation.config'], { ns: 'common' })}
              </Button>
            )}
            {supportsEmbedded && (
              <Button
                className="flex items-center gap-1 px-3"
                variant="secondary"
                disabled={!running}
                onClick={() => setShowEmbedded(true)}
              >
                <span aria-hidden className="i-ri-window-line size-4" />
                {t(($) => $['studio.accessPoint.embedIntoSite'], { ns: 'deployments' })}
              </Button>
            )}
            <Button
              className="flex items-center gap-1 px-3"
              variant="secondary"
              disabled={!running}
              onClick={() => setShowCustomize(true)}
            >
              <span aria-hidden className="i-custom-vender-deploy-code-block size-4" />
              {t(($) => $['overview.appInfo.customize.entry'], {
                ns: 'appOverview',
              })}
            </Button>
            <Button
              className="flex items-center gap-1 px-3"
              variant="secondary"
              disabled={availability !== 'available' || !canEdit}
              onClick={() => setShowSettings(true)}
            >
              <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              {t(($) => $['settings.settings'], { ns: 'common' })}
            </Button>
          </>
        }
      >
        <AccessPointUrl
          label={t(($) => $['agentDetail.access.webApp.accessUrl'], { ns: 'agentV2' })}
          value={webAppUrl}
          enabled={running}
          loading={availability === 'loading'}
          unavailable={availability === 'unavailable'}
          unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
            ns: 'deployments',
          })}
          showOpen
          showQrCode
          showRegenerate
          openLabel={t(($) => $['studio.accessPoint.open'], { ns: 'deployments' })}
          openUrl={webAppUrl}
          regenerateLabel={t(($) => $['overview.appInfo.regenerate'], {
            ns: 'appOverview',
          })}
          regenerateDisabled={!canEdit}
          regenerating={regenerating}
          onRegenerate={() => setShowRegenerate(true)}
        />
        {showAccessControl && (
          <WebAppAccessControlEntry
            accessConfigured={accessConfigured}
            accessIcon={accessIcon}
            accessLabel={t(accessLabel, { ns: 'app' })}
            available={availability === 'available'}
            disabled={!canManageAccess}
            onClick={() => setShowAccess(true)}
          />
        )}
      </AccessPointCard>

      <SettingsModal
        isChat={appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW}
        canDeploy={canDeploy}
        appInfo={appInfo}
        isShow={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={onSaveSiteConfig}
      />
      {supportsEmbedded && (
        <EmbeddedModal
          siteInfo={appInfo.site}
          isShow={showEmbedded}
          onClose={() => setShowEmbedded(false)}
          appBaseUrl={appInfo.site?.app_base_url}
          accessToken={appInfo.site?.access_token}
          hiddenInputs={hiddenLaunchVariables}
        />
      )}
      <CustomizeModal
        isShow={showCustomize}
        onClose={() => setShowCustomize(false)}
        appId={appInfo.id}
        api_base_url={appInfo.api_base_url}
        mode={appInfo.mode}
      />
      {showAccess && (
        <AccessControl
          app={appInfo}
          onClose={() => setShowAccess(false)}
          onConfirm={async () => {
            await onRefreshApp()
            setShowAccess(false)
          }}
        />
      )}
      <WorkflowLaunchDialog
        hiddenVariables={hiddenLaunchVariables}
        open={showWorkflowLaunch}
        targetUrl={webAppUrl}
        onOpenChange={setShowWorkflowLaunch}
      />
      <AlertDialog open={showRegenerate} onOpenChange={(open) => !open && setShowRegenerate(false)}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['overview.appInfo.regenerate'], { ns: 'appOverview' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-tertiary">
              {t(($) => $['overview.appInfo.regenerateNotice'], { ns: 'appOverview' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={() => void handleRegenerate()}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
