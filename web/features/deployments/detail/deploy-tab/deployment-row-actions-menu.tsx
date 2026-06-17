'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME } from '../table-styles'

export function DeploymentActionsDropdown({
  currentReleaseId,
  deployActionLabel,
  failedReleaseId,
  isDeployFailed,
  isDeploymentInProgress,
  isUndeployed,
  undeployActionDisabled,
  onDeploy,
  onRequestUndeploy,
  onViewError,
}: {
  currentReleaseId?: string
  deployActionLabel: string
  failedReleaseId?: string
  isDeployFailed: boolean
  isDeploymentInProgress: boolean
  isUndeployed: boolean
  undeployActionDisabled: boolean
  onDeploy: (releaseId?: string) => void
  onRequestUndeploy: () => void
  onViewError: () => void
}) {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)

  if (isDeploymentInProgress)
    return null

  function handleDeployAction(releaseId?: string) {
    onDeploy(releaseId)
    setOpen(false)
  }

  function handleViewError() {
    onViewError()
    setOpen(false)
  }

  function handleRequestUndeploy() {
    if (undeployActionDisabled)
      return

    onRequestUndeploy()
    setOpen(false)
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={t('deployTab.moreActions')}
        className={DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME}
      >
        <span aria-hidden className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-44">
          {isDeployFailed
            ? (
                <>
                  <DropdownMenuItem
                    className="gap-2 px-3"
                    onClick={handleViewError}
                  >
                    <span aria-hidden className="i-ri-error-warning-line size-4 shrink-0 text-text-tertiary" />
                    <span className="system-sm-regular text-text-secondary">{t('deployTab.viewError')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 px-3"
                    onClick={() => handleDeployAction(failedReleaseId)}
                  >
                    <span aria-hidden className="i-ri-refresh-line size-4 shrink-0 text-text-tertiary" />
                    <span className="system-sm-regular text-text-secondary">
                      {failedReleaseId ? t('deployTab.retry') : t('deployTab.deployOtherVersion')}
                    </span>
                  </DropdownMenuItem>
                </>
              )
            : (
                <>
                  {!isUndeployed && currentReleaseId && (
                    <DropdownMenuItem
                      className="gap-2 px-3"
                      onClick={() => handleDeployAction(currentReleaseId)}
                    >
                      <span aria-hidden className="i-ri-refresh-line size-4 shrink-0 text-text-tertiary" />
                      <span className="system-sm-regular text-text-secondary">{t('deployTab.redeploy')}</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="gap-2 px-3"
                    onClick={() => handleDeployAction()}
                  >
                    <span aria-hidden className="i-ri-rocket-line size-4 shrink-0 text-text-tertiary" />
                    <span className="system-sm-regular text-text-secondary">{deployActionLabel}</span>
                  </DropdownMenuItem>
                </>
              )}
          {!isUndeployed && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={undeployActionDisabled}
                aria-disabled={undeployActionDisabled}
                className={cn(
                  'gap-2 px-3',
                  undeployActionDisabled && 'cursor-not-allowed opacity-60',
                )}
                onClick={handleRequestUndeploy}
              >
                <span aria-hidden className="i-ri-logout-box-line size-4 shrink-0" />
                <span className="system-sm-regular">{t('deployTab.undeploy')}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
