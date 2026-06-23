'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TitleTooltip } from '../../components/title-tooltip'
import { openDeployDrawerAtom } from '../../deploy-drawer/state'
import { isUndeployedDeploymentRow } from '../../shared/domain/runtime-status'
import { DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME } from '../table-styles'
import { DeleteReleaseDialog } from './delete-release-dialog'
import {
  buildDeployMenuSections,
  releaseUsageCount,
} from './deploy-release-menu-utils'
import { EditReleaseDialog } from './edit-release-dialog'
import {
  deleteReleaseMutationAtom,
  deployReleaseMenuAppInstanceQueryAtom,
  deployReleaseMenuEnvironmentDeploymentsQueryAtom,
  deployReleaseMenuOpenReleaseIdAtom,
  exportReleaseDslMutationAtom,
  setDeployReleaseMenuOpenAtom,
} from './state'

export function DeployReleaseMenu({ appInstanceId, releaseId, releaseRows, onDeleted }: {
  appInstanceId: string
  releaseId: string
  releaseRows: Release[]
  onDeleted?: () => void
}) {
  const { t } = useTranslation('deployments')
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const openReleaseMenuId = useAtomValue(deployReleaseMenuOpenReleaseIdAtom)
  const setDeployReleaseMenuOpen = useSetAtom(setDeployReleaseMenuOpenAtom)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const open = openReleaseMenuId === releaseId
  const environmentDeploymentsQuery = useAtomValue(deployReleaseMenuEnvironmentDeploymentsQueryAtom)
  const appInstanceQuery = useAtomValue(deployReleaseMenuAppInstanceQueryAtom)
  const deleteRelease = useAtomValue(deleteReleaseMutationAtom)
  const exportReleaseDslMutation = useAtomValue(exportReleaseDslMutationAtom)

  const environments = (environmentDeploymentsQuery.data?.environmentDeployments ?? [])
    .map(row => row.environment)
  const deploymentRows = environmentDeploymentsQuery.data?.environmentDeployments.filter(row => !isUndeployedDeploymentRow(row)) ?? []
  const targetRelease = releaseRows.find(release => release.id === releaseId)
  const appInstanceName = appInstanceQuery.data?.appInstance.displayName

  if (!targetRelease)
    return null

  const release = targetRelease
  const targetReleaseName = release.displayName
  const deleteUsageCount = releaseUsageCount(releaseId, deploymentRows)
  const isCheckingDeleteUsage = open && environmentDeploymentsQuery.isLoading
  const hasDeleteUsageCheckFailed = open && environmentDeploymentsQuery.isError
  const isReleaseInUse = deleteUsageCount > 0
  const isDeletingRelease = deleteRelease.isPending
  const isExportingDsl = exportReleaseDslMutation.isPending
  const deleteDisabledReason = isCheckingDeleteUsage
    ? t('versions.disabledReason.checkingDeployments')
    : hasDeleteUsageCheckFailed
      ? t('versions.disabledReason.checkDeploymentsFailed')
      : isReleaseInUse
        ? t('versions.disabledReason.releaseInUse', { count: deleteUsageCount })
        : undefined
  const deleteActionDisabled = isDeletingRelease || isCheckingDeleteUsage || hasDeleteUsageCheckFailed || isReleaseInUse

  function handleOpenChange(nextOpen: boolean) {
    setDeployReleaseMenuOpen({ releaseId, open: nextOpen })
  }

  function handleExportDsl() {
    if (isExportingDsl)
      return

    exportReleaseDslMutation.mutate(
      { release, releaseId, appInstanceName },
      {
        onSuccess: () => {
          handleOpenChange(false)
        },
        onError: () => {
          toast.error(t('versions.exportDslFailed'))
        },
      },
    )
  }

  function handleDeleteRelease() {
    if (deleteActionDisabled)
      return

    deleteRelease.mutate(
      {
        params: {
          releaseId,
        },
      },
      {
        onSuccess: () => {
          setShowDeleteConfirm(false)
          toast.success(t('versions.deleteSuccess', { name: targetReleaseName }))
          onDeleted?.()
        },
        onError: () => {
          toast.error(t('versions.deleteFailed'))
        },
      },
    )
  }

  const groupedRows = buildDeployMenuSections({
    environments,
    environmentDeployments: environmentDeploymentsQuery.data?.environmentDeployments ?? [],
    releaseRows,
    releaseId,
    targetRelease: release,
    t,
  })

  return (
    <>
      <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          aria-label={t('versions.moreActions')}
          className={DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME}
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        {open && (
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-60">
            <DropdownMenuItem
              className="gap-2 px-3"
              onClick={() => {
                handleOpenChange(false)
                setShowEditDialog(true)
              }}
            >
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span className="system-sm-regular text-text-secondary">
                {t('versions.editRelease')}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isExportingDsl}
              aria-disabled={isExportingDsl}
              className={cn(
                'gap-2 px-3',
                isExportingDsl && 'cursor-not-allowed opacity-60',
              )}
              onClick={handleExportDsl}
            >
              <span aria-hidden className="i-ri-download-2-line size-4 shrink-0 text-text-tertiary" />
              <span className="system-sm-regular text-text-secondary">
                {isExportingDsl ? t('versions.exportingDsl') : t('versions.exportDsl')}
              </span>
            </DropdownMenuItem>
            {groupedRows.length > 0 && <div className="my-1 border-t border-divider-subtle" aria-hidden />}
            {groupedRows.map((section, sectionIndex) => (
              <div key={section.group}>
                {sectionIndex > 0 && <div className="my-1 border-t border-divider-subtle" aria-hidden />}
                <div className="px-3 pt-1.5 pb-1 system-2xs-medium-uppercase text-text-quaternary">
                  {t(`versions.groupHeader.${section.group}`)}
                </div>
                {section.rows.map((row) => {
                  const isDisabled = row.state === 'current' || row.state === 'deploying'
                  return (
                    <TitleTooltip key={row.environmentId} content={isDisabled ? row.disabledReason : undefined}>
                      <DropdownMenuItem
                        disabled={isDisabled}
                        aria-disabled={isDisabled}
                        className={cn(
                          'gap-2 px-3',
                          isDisabled && 'cursor-not-allowed opacity-60',
                        )}
                        onClick={() => {
                          if (isDisabled)
                            return
                          handleOpenChange(false)
                          openDeployDrawer({ appInstanceId, environmentId: row.environmentId, releaseId })
                        }}
                      >
                        <span className="system-sm-regular text-text-secondary">
                          {row.label}
                        </span>
                      </DropdownMenuItem>
                    </TitleTooltip>
                  )
                })}
              </div>
            ))}
            <div className="my-1 border-t border-divider-subtle" aria-hidden />
            <TitleTooltip content={deleteDisabledReason}>
              <DropdownMenuItem
                variant="destructive"
                disabled={deleteActionDisabled}
                aria-disabled={deleteActionDisabled}
                className={cn(
                  'gap-2 px-3',
                  deleteActionDisabled && 'cursor-not-allowed opacity-60',
                )}
                onClick={() => {
                  if (deleteActionDisabled)
                    return
                  handleOpenChange(false)
                  setShowDeleteConfirm(true)
                }}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                <span className="system-sm-regular">{t('versions.deleteRelease')}</span>
              </DropdownMenuItem>
            </TitleTooltip>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      <EditReleaseDialog
        release={release}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
      />

      <DeleteReleaseDialog
        open={showDeleteConfirm}
        release={release}
        isDeleting={isDeletingRelease}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDeleteRelease}
      />
    </>
  )
}
