import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { checkIsUsedInApp, deleteDataset } from '@/service/datasets'
import { downloadBlob } from '@/utils/download'
import { getErrorMessage } from '@/utils/error-message'
import { getDatasetACLCapabilities } from '@/utils/permission'
import RenameDatasetModal from '../../datasets/rename-modal'

type DropDownProps = {
  expand: boolean
  triggerClassName?: string
}

const DropDown = ({ expand, triggerClassName }: DropDownProps) => {
  const { t } = useTranslation(['app', 'common', 'dataset', 'datasetPipeline', 'navigation'])
  const { push, replace } = useRouter()
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [confirmMessage, setConfirmMessage] = useState<string>('')
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  const dataset = useDatasetDetailContextWithSelector(
    (state) => state.dataset,
  ) as DatasetDetailWithPartialMembersResponse
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isRbacEnabled = systemFeatures.rbac_enabled
  const datasetACLCapabilities = React.useMemo(
    () =>
      getDatasetACLCapabilities(dataset?.permission_keys, {
        currentUserId,
        resourceMaintainer: dataset?.maintainer,
        workspacePermissionKeys,
        isRbacEnabled,
      }),
    [
      dataset?.maintainer,
      dataset?.permission_keys,
      currentUserId,
      isRbacEnabled,
      workspacePermissionKeys,
    ],
  )
  const canShowOperations =
    datasetACLCapabilities.canEdit ||
    datasetACLCapabilities.canImportExportDSL ||
    datasetACLCapabilities.canAccessConfig ||
    datasetACLCapabilities.canDelete

  const queryClient = useQueryClient()
  const invalidDatasetList = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
  }, [queryClient])
  const invalidDatasetDetail = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.datasets.byDatasetId.get.queryKey({
        input: { params: { dataset_id: dataset.id } },
      }),
    })
  }, [queryClient, dataset.id])

  const refreshDataset = useCallback(() => {
    invalidDatasetList()
    invalidDatasetDetail()
  }, [invalidDatasetDetail, invalidDatasetList])

  const openRenameModal = useCallback(() => {
    queueMicrotask(() => {
      setShowRenameModal(true)
    })
  }, [])

  const { mutateAsync: exportPipelineConfig } = useMutation(
    consoleQuery.rag.pipelines.byPipelineId.exports.get.mutationOptions(),
  )

  const handleExportPipeline = useCallback(
    async (include = false) => {
      const { pipeline_id, name } = dataset
      if (!pipeline_id) return
      try {
        const { data } = await exportPipelineConfig({
          params: { pipeline_id },
          query: { include_secret: String(include) },
        })
        const file = new Blob([data], { type: 'application/yaml' })
        downloadBlob({ data: file, fileName: `${name}.pipeline` })
      } catch {
        toast.error(t(($) => $.exportFailed, { ns: 'app' }))
      }
    },
    [dataset, exportPipelineConfig, t],
  )

  const detectIsUsedByApp = useCallback(async () => {
    try {
      const { is_using: isUsedByApp } = await checkIsUsedInApp(dataset.id)
      setConfirmMessage(
        isUsedByApp
          ? t(($) => $.datasetUsedByApp, { ns: 'dataset' })!
          : t(($) => $.deleteDatasetConfirmContent, { ns: 'dataset' })!,
      )
      setShowConfirmDelete(true)
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) ?? 'Unknown error')
    }
  }, [dataset.id, t])

  const openAccessConfig = useCallback(() => {
    push(`/datasets/${dataset.id}/access-config`)
  }, [dataset.id, push])

  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteDataset(dataset.id)
      toast(
        t(($) => $.datasetDeleted, { ns: 'dataset' }),
        { type: 'success' },
      )
      invalidDatasetList()
      replace('/datasets')
    } finally {
      setShowConfirmDelete(false)
    }
  }, [dataset.id, replace, invalidDatasetList, t])

  if (!canShowOperations) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            size={expand ? 'lg' : 'md'}
            className={cn('data-popup-open:bg-state-base-hover', triggerClassName)}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <DropdownMenuContent
        placement={expand ? 'bottom-end' : 'right-start'}
        sideOffset={4}
        className="w-50"
      >
        {datasetACLCapabilities.canEdit && (
          <DropdownMenuItem onClick={openRenameModal}>
            <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
            {t(($) => $['operation.edit'], { ns: 'common' })}
          </DropdownMenuItem>
        )}
        {datasetACLCapabilities.canImportExportDSL && dataset.runtime_mode === 'rag_pipeline' && (
          <DropdownMenuItem onClick={() => void handleExportPipeline()}>
            <span aria-hidden className="i-ri-file-download-line size-4 text-text-tertiary" />
            {t(($) => $['operations.exportPipeline'], { ns: 'datasetPipeline' })}
          </DropdownMenuItem>
        )}
        {datasetACLCapabilities.canAccessConfig && (
          <DropdownMenuItem onClick={openAccessConfig}>
            <span aria-hidden className="i-ri-lock-2-line size-4 text-text-tertiary" />
            {t(($) => $['settings.resourceAccess'], { ns: 'navigation' })}
          </DropdownMenuItem>
        )}
        {datasetACLCapabilities.canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={detectIsUsedByApp}>
              <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      {showRenameModal && (
        <RenameDatasetModal
          show={showRenameModal}
          dataset={dataset!}
          onClose={() => setShowRenameModal(false)}
          onSuccess={refreshDataset}
        />
      )}
      <AlertDialog
        open={showConfirmDelete}
        onOpenChange={(open) => !open && setShowConfirmDelete(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.deleteDatasetConfirmTitle, { ns: 'dataset' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={onConfirmDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DropdownMenu>
  )
}

export default React.memo(DropDown)
