import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useRouter } from '@/next/navigation'
import { checkIsUsedInApp, deleteDataset } from '@/service/datasets'
import { datasetDetailQueryKeyPrefix, useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { useInvalid } from '@/service/use-base'
import { useExportPipelineDSL } from '@/service/use-pipeline'
import { downloadBlob } from '@/utils/download'
import ActionButton from '../../base/action-button'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '../../base/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../base/ui/dropdown-menu'
import RenameDatasetModal from '../../datasets/rename-modal'
import Menu from './menu'

type DropDownProps = {
  expand: boolean
}

const DropDown = ({
  expand,
}: DropDownProps) => {
  const { t } = useTranslation()
  const { replace } = useRouter()
  const [open, setOpen] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [confirmMessage, setConfirmMessage] = useState<string>('')
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  const isCurrentWorkspaceDatasetOperator = useAppContextWithSelector(state => state.isCurrentWorkspaceDatasetOperator)
  const dataset = useDatasetDetailContextWithSelector(state => state.dataset) as DataSet

  const invalidDatasetList = useInvalidDatasetList()
  const invalidDatasetDetail = useInvalid([...datasetDetailQueryKeyPrefix, dataset.id])

  const refreshDataset = useCallback(() => {
    invalidDatasetList()
    invalidDatasetDetail()
  }, [invalidDatasetDetail, invalidDatasetList])

  const openRenameModal = useCallback(() => {
    setOpen(false)
    queueMicrotask(() => {
      setShowRenameModal(true)
    })
  }, [])

  const { mutateAsync: exportPipelineConfig } = useExportPipelineDSL()

  const handleExportPipeline = useCallback(async (include = false) => {
    const { pipeline_id, name } = dataset
    if (!pipeline_id)
      return
    setOpen(false)
    try {
      const { data } = await exportPipelineConfig({
        pipelineId: pipeline_id,
        include,
      })
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${name}.pipeline` })
    }
    catch {
      toast(t('exportFailed', { ns: 'app' }), { type: 'error' })
    }
  }, [dataset, exportPipelineConfig, t])

  const detectIsUsedByApp = useCallback(async () => {
    setOpen(false)
    try {
      const { is_using: isUsedByApp } = await checkIsUsedInApp(dataset.id)
      setConfirmMessage(isUsedByApp ? t('datasetUsedByApp', { ns: 'dataset' })! : t('deleteDatasetConfirmContent', { ns: 'dataset' })!)
      setShowConfirmDelete(true)
    }
    catch (e: any) {
      const res = await e.json()
      toast(res?.message || 'Unknown error', { type: 'error' })
    }
  }, [dataset.id, t])

  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteDataset(dataset.id)
      toast(t('datasetDeleted', { ns: 'dataset' }), { type: 'success' })
      invalidDatasetList()
      replace('/datasets')
    }
    finally {
      setShowConfirmDelete(false)
    }
  }, [dataset.id, replace, invalidDatasetList, t])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger render={<div />}>
        <ActionButton className={cn(expand ? 'size-8 rounded-lg' : 'size-6 rounded-md', open && 'bg-state-base-hover')}>
          <span aria-hidden className="i-ri-more-fill size-4" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement={expand ? 'bottom-end' : 'right-start'}
        sideOffset={4}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <Menu
          showDelete={!isCurrentWorkspaceDatasetOperator}
          openRenameModal={openRenameModal}
          handleExportPipeline={handleExportPipeline}
          detectIsUsedByApp={detectIsUsedByApp}
        />
      </DropdownMenuContent>
      {showRenameModal && (
        <RenameDatasetModal
          show={showRenameModal}
          dataset={dataset!}
          onClose={() => setShowRenameModal(false)}
          onSuccess={refreshDataset}
        />
      )}
      <AlertDialog open={showConfirmDelete} onOpenChange={open => !open && setShowConfirmDelete(false)}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('deleteDatasetConfirmTitle', { ns: 'dataset' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {confirmMessage}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={onConfirmDelete}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </DropdownMenu>
  )
}

export default React.memo(DropDown)
