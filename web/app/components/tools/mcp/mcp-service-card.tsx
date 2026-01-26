'use client'
import type { TFunction } from 'i18next'
import type { FC, ReactNode } from 'react'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { RiEditLine, RiLoopLeftLine } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Divider from '@/app/components/base/divider'
import { Mcp } from '@/app/components/base/icons/src/vender/other'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import Indicator from '@/app/components/header/indicator'
import MCPServerModal from '@/app/components/tools/mcp/mcp-server-modal'
import { useDocLink } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import { useMCPServiceCardState } from './hooks/use-mcp-service-card'

// Sub-components
type StatusIndicatorProps = {
  serverActivated: boolean
}

const StatusIndicator: FC<StatusIndicatorProps> = ({ serverActivated }) => {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1">
      <Indicator color={serverActivated ? 'green' : 'yellow'} />
      <div className={cn('system-xs-semibold-uppercase', serverActivated ? 'text-text-success' : 'text-text-warning')}>
        {serverActivated
          ? t('overview.status.running', { ns: 'appOverview' })
          : t('overview.status.disable', { ns: 'appOverview' })}
      </div>
    </div>
  )
}

type ServerURLSectionProps = {
  serverURL: string
  serverPublished: boolean
  isCurrentWorkspaceManager: boolean
  genLoading: boolean
  onRegenerate: () => void
}

const ServerURLSection: FC<ServerURLSectionProps> = ({
  serverURL,
  serverPublished,
  isCurrentWorkspaceManager,
  genLoading,
  onRegenerate,
}) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-start justify-center self-stretch">
      <div className="system-xs-medium pb-1 text-text-tertiary">
        {t('mcp.server.url', { ns: 'tools' })}
      </div>
      <div className="inline-flex h-9 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
        <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-text-secondary">
            {serverURL}
          </div>
        </div>
        {serverPublished && (
          <>
            <CopyFeedback content={serverURL} className="!size-6" />
            <Divider type="vertical" className="!mx-0.5 !h-3.5 shrink-0" />
            {isCurrentWorkspaceManager && (
              <Tooltip popupContent={t('overview.appInfo.regenerate', { ns: 'appOverview' }) || ''}>
                <div
                  className="cursor-pointer rounded-md p-1 hover:bg-state-base-hover"
                  onClick={onRegenerate}
                >
                  <RiLoopLeftLine className={cn('h-4 w-4 text-text-tertiary hover:text-text-secondary', genLoading && 'animate-spin')} />
                </div>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
  )
}

type TriggerModeOverlayProps = {
  triggerModeMessage: ReactNode
}

const TriggerModeOverlay: FC<TriggerModeOverlayProps> = ({ triggerModeMessage }) => {
  if (triggerModeMessage) {
    return (
      <Tooltip
        popupContent={triggerModeMessage}
        popupClassName="max-w-64 rounded-xl bg-components-panel-bg px-3 py-2 text-xs text-text-secondary shadow-lg"
        position="right"
      >
        <div className="absolute inset-0 z-10 cursor-not-allowed rounded-xl" aria-hidden="true"></div>
      </Tooltip>
    )
  }
  return <div className="absolute inset-0 z-10 cursor-not-allowed rounded-xl" aria-hidden="true"></div>
}

// Helper function for tooltip content
type TooltipContentParams = {
  toggleDisabled: boolean
  appUnpublished: boolean
  missingStartNode: boolean
  triggerModeMessage: ReactNode
  t: TFunction
  docLink: ReturnType<typeof useDocLink>
}

function getTooltipContent({
  toggleDisabled,
  appUnpublished,
  missingStartNode,
  triggerModeMessage,
  t,
  docLink,
}: TooltipContentParams): ReactNode {
  if (!toggleDisabled)
    return ''

  if (appUnpublished)
    return t('mcp.server.publishTip', { ns: 'tools' })

  if (missingStartNode) {
    return (
      <>
        <div className="mb-1 text-xs font-normal text-text-secondary">
          {t('overview.appInfo.enableTooltip.description', { ns: 'appOverview' })}
        </div>
        <div
          className="cursor-pointer text-xs font-normal text-text-accent hover:underline"
          onClick={() => window.open(docLink('/use-dify/nodes/user-input'), '_blank')}
        >
          {t('overview.appInfo.enableTooltip.learnMore', { ns: 'appOverview' })}
        </div>
      </>
    )
  }

  return triggerModeMessage || ''
}

// Main component
export type IAppCardProps = {
  appInfo: AppDetailResponse & Partial<AppSSO>
  triggerModeDisabled?: boolean
  triggerModeMessage?: ReactNode
}

const MCPServiceCard: FC<IAppCardProps> = ({
  appInfo,
  triggerModeDisabled = false,
  triggerModeMessage = '',
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const appId = appInfo.id

  const {
    genLoading,
    isLoading,
    serverPublished,
    serverActivated,
    serverURL,
    detail,
    isCurrentWorkspaceManager,
    toggleDisabled,
    isMinimalState,
    appUnpublished,
    missingStartNode,
    showConfirmDelete,
    showMCPServerModal,
    latestParams,
    handleGenCode,
    handleStatusChange,
    handleServerModalHide,
    openConfirmDelete,
    closeConfirmDelete,
    openServerModal,
  } = useMCPServiceCardState(appInfo, triggerModeDisabled)

  // Pending status for optimistic updates (null means use server state)
  const [pendingStatus, setPendingStatus] = useState<boolean | null>(null)
  const activated = pendingStatus ?? serverActivated

  const onChangeStatus = async (state: boolean) => {
    setPendingStatus(state)
    const result = await handleStatusChange(state)
    if (!result.activated && state) {
      // Server modal was opened instead, clear pending status
      setPendingStatus(null)
    }
  }

  const onServerModalHide = () => {
    handleServerModalHide(serverActivated)
    // Clear pending status when modal closes to sync with server state
    setPendingStatus(null)
  }

  const onConfirmRegenerate = () => {
    handleGenCode()
    closeConfirmDelete()
  }

  if (isLoading)
    return null

  const tooltipContent = getTooltipContent({
    toggleDisabled,
    appUnpublished,
    missingStartNode,
    triggerModeMessage,
    t,
    docLink,
  })

  return (
    <>
      <div className={cn('w-full max-w-full rounded-xl border-l-[0.5px] border-t border-effects-highlight', isMinimalState && 'h-12')}>
        <div className={cn('relative rounded-xl bg-background-default', triggerModeDisabled && 'opacity-60')}>
          {triggerModeDisabled && (
            <TriggerModeOverlay triggerModeMessage={triggerModeMessage} />
          )}
          <div className={cn('flex w-full flex-col items-start justify-center gap-3 self-stretch p-3', isMinimalState ? 'border-0' : 'border-b-[0.5px] border-divider-subtle')}>
            <div className="flex w-full items-center gap-3 self-stretch">
              <div className="flex grow items-center">
                <div className="mr-2 shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-brand-blue-brand-500 p-1 shadow-md">
                  <Mcp className="h-4 w-4 text-text-primary-on-surface" />
                </div>
                <div className="group w-full">
                  <div className="system-md-semibold min-w-0 overflow-hidden text-ellipsis break-normal text-text-secondary group-hover:text-text-primary">
                    {t('mcp.server.title', { ns: 'tools' })}
                  </div>
                </div>
              </div>
              <StatusIndicator serverActivated={serverActivated} />
              <Tooltip
                popupContent={tooltipContent}
                position="right"
                popupClassName="w-58 max-w-60 rounded-xl bg-components-panel-bg px-3.5 py-3 shadow-lg"
                offset={24}
              >
                <div>
                  <Switch defaultValue={activated} onChange={onChangeStatus} disabled={toggleDisabled} />
                </div>
              </Tooltip>
            </div>
            {!isMinimalState && (
              <ServerURLSection
                serverURL={serverURL}
                serverPublished={serverPublished}
                isCurrentWorkspaceManager={isCurrentWorkspaceManager}
                genLoading={genLoading}
                onRegenerate={openConfirmDelete}
              />
            )}
          </div>
          {!isMinimalState && (
            <div className="flex items-center gap-1 self-stretch p-3">
              <Button
                disabled={toggleDisabled}
                size="small"
                variant="ghost"
                onClick={openServerModal}
              >
                <div className="flex items-center justify-center gap-[1px]">
                  <RiEditLine className="h-3.5 w-3.5" />
                  <div className="system-xs-medium px-[3px] text-text-tertiary">
                    {serverPublished ? t('mcp.server.edit', { ns: 'tools' }) : t('mcp.server.addDescription', { ns: 'tools' })}
                  </div>
                </div>
              </Button>
            </div>
          )}
        </div>
      </div>

      {showMCPServerModal && (
        <MCPServerModal
          show={showMCPServerModal}
          appID={appId}
          data={serverPublished ? detail : undefined}
          latestParams={latestParams}
          onHide={onServerModalHide}
          appInfo={appInfo}
        />
      )}

      {showConfirmDelete && (
        <Confirm
          type="warning"
          title={t('overview.appInfo.regenerate', { ns: 'appOverview' })}
          content={t('mcp.server.reGen', { ns: 'tools' })}
          isShow={showConfirmDelete}
          onConfirm={onConfirmRegenerate}
          onCancel={closeConfirmDelete}
        />
      )}
    </>
  )
}

export default MCPServiceCard
