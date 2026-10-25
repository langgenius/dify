import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { AlertDialog, AlertDialogContent } from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
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
import { downloadBlob } from '@/utils/download'
import { getDatasetACLCapabilities } from '@/utils/permission'
import { DeleteDatasetConfirmation } from '../../datasets/delete-dataset-confirmation'
import RenameDatasetModal from '../../datasets/rename-modal'

type DropDownProps = {
  expand: boolean
  triggerClassName?: string
}

const DropDown = ({ expand, triggerClassName }: DropDownProps) => {
  const { t } = useTranslation(['app', 'common', 'dataset', 'datasetPipeline', 'navigation'])
  const { push, replace } = useRouter()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deletion = useMutation(
    consoleQuery.datasets.byDatasetId.delete.mutationOptions({ context: { silent: true } }),
  )

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

  const openAccessConfig = useCallback(() => {
    push(`/datasets/${dataset.id}/access-config`)
  }, [dataset.id, push])

  if (!canShowOperations) return null

  return (
    <Menu>
      <MenuTrigger
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
      <MenuContent
        side={expand ? 'bottom' : 'right'}
        align={expand ? 'end' : 'start'}
        className="w-50"
      >
        {datasetACLCapabilities.canEdit && (
          <MenuItem onClick={() => setRenameOpen(true)}>
            <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
            {t(($) => $['operation.edit'], { ns: 'common' })}
          </MenuItem>
        )}
        {datasetACLCapabilities.canImportExportDSL && dataset.runtime_mode === 'rag_pipeline' && (
          <MenuItem onClick={() => void handleExportPipeline()}>
            <span aria-hidden className="i-ri-file-download-line size-4 text-text-tertiary" />
            {t(($) => $['operations.exportPipeline'], { ns: 'datasetPipeline' })}
          </MenuItem>
        )}
        {datasetACLCapabilities.canAccessConfig && (
          <MenuItem onClick={openAccessConfig}>
            <span aria-hidden className="i-ri-lock-2-line size-4 text-text-tertiary" />
            {t(($) => $['settings.resourceAccess'], { ns: 'navigation' })}
          </MenuItem>
        )}
        {datasetACLCapabilities.canDelete && (
          <>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
              <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </MenuItem>
          </>
        )}
      </MenuContent>
      <RenameDatasetModal
        open={renameOpen}
        dataset={dataset}
        onOpenChange={setRenameOpen}
        onSuccess={refreshDataset}
      />
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open, details) => {
          if (!open && deletion.isPending) {
            details.cancel()
            return
          }
          setDeleteOpen(open)
        }}
        onOpenChangeComplete={(open) => {
          if (!open) deletion.reset()
        }}
      >
        <AlertDialogContent>
          <DeleteDatasetConfirmation
            datasetId={dataset.id}
            isPending={deletion.isPending}
            error={deletion.isError ? t(($) => $['api.actionFailed'], { ns: 'common' }) : undefined}
            onConfirm={() => {
              if (deletion.isPending) return
              deletion.mutate(
                { params: { dataset_id: dataset.id } },
                {
                  onSuccess: () => {
                    setDeleteOpen(false)
                    replace('/datasets')
                  },
                },
              )
            }}
          />
        </AlertDialogContent>
      </AlertDialog>
    </Menu>
  )
}

export default React.memo(DropDown)
