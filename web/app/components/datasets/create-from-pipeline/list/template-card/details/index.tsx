import React, { useMemo } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { usePipelineTemplateById } from '@/service/use-pipeline'
import type { AppIconType } from '@/types/app'
import { RiAddLine, RiCloseLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import Loading from '@/app/components/base/loading'
import { useChunkStructureConfig } from './hooks'
import ChunkStructureCard from './chunk-structure-card'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'

type DetailsProps = {
  id: string
  type: 'customized' | 'built-in'
  onApplyTemplate: () => void
  onClose: () => void
}

const Details = ({
  id,
  type,
  onApplyTemplate,
  onClose,
}: DetailsProps) => {
  const { t } = useTranslation()
  const { data: pipelineTemplateInfo } = usePipelineTemplateById({
    template_id: id,
    type,
  }, true)

  const appIcon = useMemo(() => {
    if (!pipelineTemplateInfo)
      return { type: 'emoji', icon: '📙', background: '#FFF4ED' }
    const iconInfo = pipelineTemplateInfo.icon_info
    return iconInfo.icon_type === 'image'
      ? { type: 'image', url: iconInfo.icon_url || '', fileId: iconInfo.icon || '' }
      : { type: 'icon', icon: iconInfo.icon || '', background: iconInfo.icon_background || '' }
  }, [pipelineTemplateInfo])

  const chunkStructureConfig = useChunkStructureConfig()

  if (!pipelineTemplateInfo) {
    return (
      <Loading type='app' />
    )
  }

  return (
    <div className='flex h-full'>
      <div className='flex grow items-center justify-center p-3 pr-0'>
        <WorkflowPreview
          {...pipelineTemplateInfo.graph}
          className='overflow-hidden rounded-2xl'
        />
      </div>
      <div className='relative flex w-[360px] shrink-0 flex-col'>
        <button
          type='button'
          className='absolute right-4 top-4 z-10 flex size-8 items-center justify-center'
          onClick={onClose}
        >
          <RiCloseLine className='size-4 text-text-tertiary' />
        </button>
        <div className='flex items-center gap-x-3 pb-2 pl-4 pr-12 pt-6'>
          <AppIcon
            size='large'
            iconType={appIcon.type as AppIconType}
            icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
            background={appIcon.type === 'image' ? undefined : appIcon.background}
            imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
            showEditIcon
          />
          <div className='flex grow flex-col gap-y-1 py-px'>
            <div className='system-md-semibold text-text-secondary'>
              {pipelineTemplateInfo.name}
            </div>
            <div className='system-2xs-medium-uppercase text-text-tertiary'>
              {t('datasetPipeline.details.createdBy', {
                author: pipelineTemplateInfo.created_by,
              })}
            </div>
          </div>
        </div>
        <p className='system-sm-regular px-4 pb-2 pt-1 text-text-secondary'>
          {pipelineTemplateInfo.description}
        </p>
        <div className='p-3'>
          <Button
            variant='primary'
            onClick={onApplyTemplate}
            className='w-full gap-x-0.5'
          >
            <RiAddLine className='size-4' />
            <span className='px-0.5'>{t('datasetPipeline.operations.useTemplate')}</span>
          </Button>
        </div>
        <div className='flex flex-col gap-y-1 px-4 py-2'>
          <div className='flex h-6 items-center gap-x-0.5'>
            <span className='system-sm-semibold-uppercase text-text-secondary'>
              {t('datasetPipeline.details.structure')}
            </span>
            <Tooltip
              popupClassName='max-w-[240px]'
              popupContent={t('datasetPipeline.details.structureTooltip')}
            />
          </div>
          <ChunkStructureCard {...chunkStructureConfig[pipelineTemplateInfo.chunk_structure]} />
        </div>
      </div>
    </div>
  )
}

export default React.memo(Details)
