'use client'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import type { DataSet } from '@/models/datasets'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useKnowledge } from '@/hooks/use-knowledge'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tag } from '@/app/components/base/tag-management/constant'
import TagSelector from '@/app/components/base/tag-management/selector'
import cn from '@/utils/classnames'
import { useHover } from 'ahooks'
import { RiFileTextFill, RiMoreFill, RiRobot2Fill } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { checkIsUsedInApp, deleteDataset } from '@/service/datasets'
import RenameDatasetModal from '../../rename-modal'
import Confirm from '@/app/components/base/confirm'
import Toast from '@/app/components/base/toast'
import CustomPopover from '@/app/components/base/popover'
import Operations from './operations'
import AppIcon from '@/app/components/base/app-icon'
import CornerLabel from '@/app/components/base/corner-label'
import { DOC_FORM_ICON_WITH_BG, DOC_FORM_TEXT } from '@/models/datasets'
import { useExportPipelineDSL } from '@/service/use-pipeline'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

const EXTERNAL_PROVIDER = 'external'

type DatasetCardProps = {
  dataset: DataSet
  onSuccess?: () => void
}

const DatasetCard = ({
  dataset,
  onSuccess,
}: DatasetCardProps) => {
  const { t } = useTranslation()
  const { push } = useRouter()

  const isCurrentWorkspaceDatasetOperator = useAppContextWithSelector(state => state.isCurrentWorkspaceDatasetOperator)
  const [tags, setTags] = useState<Tag[]>(dataset.tags)
  const tagSelectorRef = useRef<HTMLDivElement>(null)
  const isHoveringTagSelector = useHover(tagSelectorRef)

  const [showRenameModal, setShowRenameModal] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [confirmMessage, setConfirmMessage] = useState<string>('')
  const [exporting, setExporting] = useState(false)

  const isExternalProvider = useMemo(() => {
    return dataset.provider === EXTERNAL_PROVIDER
  }, [dataset.provider])
  const isPipelineUnpublished = useMemo(() => {
    return dataset.runtime_mode === 'rag_pipeline' && !dataset.is_published
  }, [dataset.runtime_mode, dataset.is_published])
  const isShowChunkingModeIcon = useMemo(() => {
    return dataset.doc_form && (dataset.runtime_mode !== 'rag_pipeline' || dataset.is_published)
  }, [dataset.doc_form, dataset.runtime_mode, dataset.is_published])
  const isShowDocModeInfo = useMemo(() => {
    return dataset.doc_form && dataset.indexing_technique && dataset.retrieval_model_dict?.search_method && (dataset.runtime_mode !== 'rag_pipeline' || dataset.is_published)
  }, [dataset.doc_form, dataset.indexing_technique, dataset.retrieval_model_dict?.search_method, dataset.runtime_mode, dataset.is_published])

  const chunkingModeIcon = dataset.doc_form ? DOC_FORM_ICON_WITH_BG[dataset.doc_form] : React.Fragment
  const Icon = isExternalProvider ? DOC_FORM_ICON_WITH_BG.external : chunkingModeIcon
  const iconInfo = dataset.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const documentCount = useMemo(() => {
    const availableDocCount = dataset.total_available_documents ?? 0
    if (availableDocCount === dataset.document_count)
      return `${dataset.document_count}`
    if (availableDocCount < dataset.document_count)
      return `${availableDocCount} / ${dataset.document_count}`
  }, [dataset.document_count, dataset.total_available_documents])
  const documentCountTooltip = useMemo(() => {
    const availableDocCount = dataset.total_available_documents ?? 0
    if (availableDocCount === dataset.document_count)
      return t('dataset.docAllEnabled', { count: availableDocCount })
    if (availableDocCount < dataset.document_count)
      return t('dataset.partialEnabled', { count: dataset.document_count, num: availableDocCount })
  }, [t, dataset.document_count, dataset.total_available_documents])

  const { formatTimeFromNow } = useFormatTimeFromNow()

  const openRenameModal = useCallback(() => {
    setShowRenameModal(true)
  }, [])

  const { mutateAsync: exportPipelineConfig } = useExportPipelineDSL()

  const handleExportPipeline = useCallback(async (include = false) => {
    const { pipeline_id, name } = dataset
    if (!pipeline_id)
      return

    if (exporting)
      return

    try {
      setExporting(true)
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
    finally {
      setExporting(false)
    }
  }, [dataset, exportPipelineConfig, exporting, t])

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
  }, [dataset.id, t])

  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteDataset(dataset.id)
      Toast.notify({ type: 'success', message: t('dataset.datasetDeleted') })
      if (onSuccess)
        onSuccess()
    }
    finally {
      setShowConfirmDelete(false)
    }
  }, [dataset.id, onSuccess, t])

  useEffect(() => {
    setTags(dataset.tags)
  }, [dataset])

  return (
    <>
      <div
        className='group relative col-span-1 flex h-[166px] cursor-pointer flex-col rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-all duration-200 ease-in-out hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5'
        data-disable-nprogress={true}
        onClick={(e) => {
          e.preventDefault()
          if (isExternalProvider)
            push(`/datasets/${dataset.id}/hitTesting`)
          else if (isPipelineUnpublished)
            push(`/datasets/${dataset.id}/pipeline`)
          else
            push(`/datasets/${dataset.id}/documents`)
        }}
      >
        {!dataset.embedding_available && (
          <CornerLabel
            label='Unavailable'
            className='absolute right-0 top-0 z-10'
            labelClassName='rounded-tr-xl' />
        )}
        <div className={cn('flex items-center gap-x-3 px-4 pb-2 pt-4', !dataset.embedding_available && 'opacity-30')}>
          <div className='relative shrink-0'>
            <AppIcon
              size='large'
              iconType={iconInfo.icon_type}
              icon={iconInfo.icon}
              background={iconInfo.icon_type === 'image' ? undefined : iconInfo.icon_background}
              imageUrl={iconInfo.icon_type === 'image' ? iconInfo.icon_url : undefined}
            />
            {(isShowChunkingModeIcon || isExternalProvider) && (
              <div className='absolute -bottom-1 -right-1 z-[5]'>
                <Icon className='size-4' />
              </div>
            )}
          </div>
          <div className='flex grow flex-col gap-y-1 overflow-hidden py-px'>
            <div
              className='system-md-semibold truncate text-text-secondary'
              title={dataset.name}
            >
              {dataset.name}
            </div>
            <div className='system-2xs-medium-uppercase flex items-center gap-x-3 text-text-tertiary'>
              {isExternalProvider && <span>{t('dataset.externalKnowledgeBase')}</span>}
              {!isExternalProvider && isShowDocModeInfo && (
                <>
                  {dataset.doc_form && <span>{t(`dataset.chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`)}</span>}
                  {dataset.indexing_technique && <span>{formatIndexingTechniqueAndMethod(dataset.indexing_technique, dataset.retrieval_model_dict?.search_method)}</span>}
                </>
              )}
            </div>
          </div>
        </div>
        <div
          className={cn('system-xs-regular line-clamp-2 h-10 px-4 py-1 text-text-tertiary', !dataset.embedding_available && 'opacity-30')}
          title={dataset.description}
        >
          {dataset.description}
        </div>
        <div
          className={cn('relative w-full px-3', !dataset.embedding_available && 'opacity-30')}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
        >
          <div
            ref={tagSelectorRef}
            className={cn(
              'invisible w-full group-hover:visible',
              tags.length > 0 && 'visible',
            )}
          >
            <TagSelector
              position='bl'
              type='knowledge'
              targetID={dataset.id}
              value={tags.map(tag => tag.id)}
              selectedTags={tags}
              onCacheUpdate={setTags}
              onChange={onSuccess}
            />
          </div>
          {/* Tag Mask */}
          <div
            className={cn(
              'absolute right-0 top-0 z-[5] h-full w-20 bg-tag-selector-mask-bg group-hover:bg-tag-selector-mask-hover-bg',
              isHoveringTagSelector && 'hidden',
            )}
          />
        </div>
        <div
          className={cn(
            'flex items-center gap-x-3 px-4 pb-3 pt-2 text-text-tertiary',
            !dataset.embedding_available && 'opacity-30',
          )}
        >
          <Tooltip popupContent={documentCountTooltip} >
            <div className='flex items-center gap-x-1'>
              <RiFileTextFill className='size-3 text-text-quaternary' />
              <span className='system-xs-medium'>{documentCount}</span>
            </div>
          </Tooltip>
          {!isExternalProvider && (
            <Tooltip popupContent={`${dataset.app_count} ${t('dataset.appCount')}`}>
              <div className='flex items-center gap-x-1'>
                <RiRobot2Fill className='size-3 text-text-quaternary' />
                <span className='system-xs-medium'>{dataset.app_count}</span>
              </div>
            </Tooltip>
          )}
          <span className='system-xs-regular text-divider-deep'>/</span>
          <span className='system-xs-regular'>{`${t('dataset.updated')} ${formatTimeFromNow(dataset.updated_at * 1000)}`}</span>
        </div>
        <div className='absolute right-2 top-2 z-[5] hidden group-hover:block'>
          <CustomPopover
            htmlContent={
              <Operations
                showDelete={!isCurrentWorkspaceDatasetOperator}
                showExportPipeline={dataset.runtime_mode === 'rag_pipeline'}
                openRenameModal={openRenameModal}
                handleExportPipeline={handleExportPipeline}
                detectIsUsedByApp={detectIsUsedByApp}
              />
            }
            className={'z-20 min-w-[186px]'}
            popupClassName={'rounded-xl bg-none shadow-none ring-0 min-w-[186px]'}
            position='br'
            trigger='click'
            btnElement={
              <div className='flex size-8 items-center justify-center rounded-[10px] hover:bg-state-base-hover'>
                <RiMoreFill className='h-5 w-5 text-text-tertiary' />
              </div>
            }
            btnClassName={open =>
              cn(
                'size-9 cursor-pointer justify-center rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0 shadow-lg shadow-shadow-shadow-5 ring-[2px] ring-inset ring-components-actionbar-bg hover:border-components-actionbar-border',
                open ? 'border-components-actionbar-border bg-state-base-hover' : '',
              )
            }
          />
        </div>
      </div>
      {showRenameModal && (
        <RenameDatasetModal
          show={showRenameModal}
          dataset={dataset}
          onClose={() => setShowRenameModal(false)}
          onSuccess={onSuccess}
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
    </>
  )
}

export default DatasetCard
