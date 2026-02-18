import type { AppIconType } from '@/types/app'
import { RiAddLine, RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import Tooltip from '@/app/components/base/tooltip'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { usePipelineTemplateById } from '@/service/use-pipeline'
import ChunkStructureCard from './chunk-structure-card'
import { useChunkStructureConfig } from './hooks'

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
      <Loading type="app" />
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex grow items-center justify-center p-3 pr-0">
        <WorkflowPreview
          {...pipelineTemplateInfo.graph}
          className="overflow-hidden rounded-2xl"
        />
      </div>
      <div className="relative flex w-[360px] shrink-0 flex-col">
        <button
          type="button"
          className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center"
          onClick={onClose}
        >
          <RiCloseLine className="size-4 text-text-tertiary" />
        </button>
        <div className="flex items-start gap-x-3 pb-2 pl-4 pr-12 pt-6">
          <AppIcon
            size="large"
            iconType={appIcon.type as AppIconType}
            icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
            background={appIcon.type === 'image' ? undefined : appIcon.background}
            imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
            showEditIcon
          />
          <div className="flex grow flex-col gap-y-1 overflow-hidden py-px">
            <div
              className="system-md-semibold truncate text-text-secondary"
              title={pipelineTemplateInfo.name}
            >
              {pipelineTemplateInfo.name}
            </div>
            {pipelineTemplateInfo.created_by && (
              <div
                className="system-2xs-medium-uppercase truncate text-text-tertiary"
                title={pipelineTemplateInfo.created_by}
              >
                {t('details.createdBy', {
                  ns: 'datasetPipeline',
                  author: pipelineTemplateInfo.created_by,
                })}
              </div>
            )}
          </div>
        </div>
        <p className="system-sm-regular px-4 pb-2 pt-1 text-text-secondary">
          {pipelineTemplateInfo.description}
        </p>
        <div className="p-3">
          <Button
            variant="primary"
            onClick={onApplyTemplate}
            className="w-full gap-x-0.5"
          >
            <RiAddLine className="size-4" />
            <span className="px-0.5">{t('operations.useTemplate', { ns: 'datasetPipeline' })}</span>
          </Button>
        </div>
        <div className="flex flex-col gap-y-1 px-4 py-2">
          <div className="flex h-6 items-center gap-x-0.5">
            <span className="system-sm-semibold-uppercase text-text-secondary">
              {t('details.structure', { ns: 'datasetPipeline' })}
            </span>
            <Tooltip
              popupClassName="max-w-[240px]"
              popupContent={t('details.structureTooltip', { ns: 'datasetPipeline' })}
            />
          </div>
          <ChunkStructureCard {...chunkStructureConfig[pipelineTemplateInfo.chunk_structure]} />
        </div>
      </div>
    </div>
  )
}

export default React.memo(Details)
