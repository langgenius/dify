import React, { useCallback, useState } from 'react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../base/portal-to-follow-elem'
import ActionButton from '../../base/action-button'
import { RiMoreFill } from '@remixicon/react'
import cn from '@/utils/classnames'
import Menu from './menu'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import type { DataSet } from '@/models/datasets'
import { datasetDetailQueryKeyPrefix, useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { useInvalid } from '@/service/use-base'
import { useExportPipelineDSL } from '@/service/use-pipeline'
import Toast from '../../base/toast'
import { useTranslation } from 'react-i18next'
import RenameDatasetModal from '../../datasets/rename-modal'
import { checkIsUsedInApp, deleteDataset } from '@/service/datasets'
import Confirm from '../../base/confirm'
import { useRouter } from 'next/navigation'

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

  const handleTrigger = useCallback(() => {
    setOpen(prev => !prev)
  }, [])

  const invalidDatasetList = useInvalidDatasetList()
  const invalidDatasetDetail = useInvalid([...datasetDetailQueryKeyPrefix, dataset.id])

  const refreshDataset = useCallback(() => {
    invalidDatasetList()
    invalidDatasetDetail()
  }, [invalidDatasetDetail, invalidDatasetList])

  const openRenameModal = useCallback(() => {
    setShowRenameModal(true)
    handleTrigger()
  }, [handleTrigger])

  const { mutateAsync: exportPipelineConfig } = useExportPipelineDSL()

  const handleExportPipeline = useCallback(async (include = false) => {
    const { pipeline_id, name } = dataset
    if (!pipeline_id)
      return
    handleTrigger()
    try {
      const { data } = await exportPipelineConfig({
        pipelineId: pipeline_id,
        include,
      })
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      const url = URL.createObjectURL(file)
      a.href = url
      a.download = `${name}.pipeline`
      a.click()
      URL.revokeObjectURL(url)
    }
    catch {
      Toast.notify({ type: 'error', message: t('app.exportFailed') })
    }
  }, [dataset, exportPipelineConfig, handleTrigger, t])

  const detectIsUsedByApp = useCallback(async () => {
    try {
      const { is_using: isUsedByApp } = await checkIsUsedInApp(dataset.id)
      setConfirmMessage(isUsedByApp ? t('dataset.datasetUsedByApp')! : t('dataset.deleteDatasetConfirmContent')!)
      setShowConfirmDelete(true)
    }
    catch (e: any) {
      const res = await e.json()
      Toast.notify({ type: 'error', message: res?.message || 'Unknown error' })
    }
    finally {
      handleTrigger()
    }
  }, [dataset.id, handleTrigger, t])

  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteDataset(dataset.id)
      Toast.notify({ type: 'success', message: t('dataset.datasetDeleted') })
      invalidDatasetList()
      replace('/datasets')
    }
    finally {
      setShowConfirmDelete(false)
    }
  }, [dataset.id, replace, invalidDatasetList, t])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement={expand ? 'bottom-end' : 'right'}
      offset={expand ? {
        mainAxis: 4,
        crossAxis: 10,
      } : {
        mainAxis: 4,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <ActionButton className={cn(expand ? 'size-8 rounded-lg' : 'size-6 rounded-md')}>
          <RiMoreFill className='size-4' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[60]'>
        <Menu
          showDelete={!isCurrentWorkspaceDatasetOperator}
          openRenameModal={openRenameModal}
          handleExportPipeline={handleExportPipeline}
          detectIsUsedByApp={detectIsUsedByApp}
        />
      </PortalToFollowElemContent>
      {showRenameModal && (
        <RenameDatasetModal
          show={showRenameModal}
          dataset={dataset!}
          onClose={() => setShowRenameModal(false)}
          onSuccess={refreshDataset}
        />
      )}
      {showConfirmDelete && (
        <Confirm
          title={t('dataset.deleteDatasetConfirmTitle')}
          content={confirmMessage}
          isShow={showConfirmDelete}
          onConfirm={onConfirmDelete}
          onCancel={() => setShowConfirmDelete(false)}
        />
      )}
    </PortalToFollowElem>
  )
}

export default React.memo(DropDown)
