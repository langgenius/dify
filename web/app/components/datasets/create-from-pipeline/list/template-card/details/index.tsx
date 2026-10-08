import type { AppIconType } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { DialogClose, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { usePipelineTemplateById } from '@/service/use-pipeline'
import ChunkStructureCard from './chunk-structure-card'
import { useChunkStructureConfig } from './hooks'

type DetailsProps = {
  id: string
  type: 'customized' | 'built-in'
  onApplyTemplate: () => void
  name: string
}

const Details = ({ id, type, name, onApplyTemplate }: DetailsProps) => {
  const structureLabelId = React.useId()

  const { t } = useTranslation(['datasetPipeline', 'common'])
  const { data: pipelineTemplateInfo } = usePipelineTemplateById(
    {
      template_id: id,
      type,
    },
    true,
  )

  const appIcon = useMemo(() => {
    if (!pipelineTemplateInfo) return { type: 'emoji', icon: '📙', background: '#FFF4ED' }
    const iconInfo = pipelineTemplateInfo.icon_info
    return iconInfo.icon_type === 'image'
      ? { type: 'image', url: iconInfo.icon_url || '', fileId: iconInfo.icon || '' }
      : { type: 'icon', icon: iconInfo.icon || '', background: iconInfo.icon_background || '' }
  }, [pipelineTemplateInfo])

  const chunkStructureConfig = useChunkStructureConfig()

  return (
    <>
      <DialogClose
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            size="lg"
            className="absolute top-4 right-4 z-10"
          >
            <span className="i-ri-close-line size-4 text-text-tertiary" aria-hidden />
          </IconButton>
        }
      />
      {pipelineTemplateInfo ? (
        <div className="flex h-full">
          <div className="flex grow items-center justify-center p-3 pr-0">
            <WorkflowPreview
              {...pipelineTemplateInfo.graph}
              className="overflow-hidden rounded-2xl"
            />
          </div>
          <div className="relative flex w-90 shrink-0 flex-col">
            <div className="flex items-start gap-x-3 pt-6 pr-12 pb-2 pl-4">
              <AppIcon
                size="large"
                iconType={appIcon.type as AppIconType}
                icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
                background={appIcon.type === 'image' ? undefined : appIcon.background}
                imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
              />
              <div className="flex grow flex-col gap-y-1 overflow-hidden py-px">
                <DialogTitle
                  className="truncate system-md-semibold text-text-secondary"
                  title={pipelineTemplateInfo.name}
                >
                  {pipelineTemplateInfo.name}
                </DialogTitle>
                {pipelineTemplateInfo.created_by && (
                  <div
                    className="truncate system-2xs-medium-uppercase text-text-tertiary"
                    title={pipelineTemplateInfo.created_by}
                  >
                    {t(($) => $['details.createdBy'], {
                      ns: 'datasetPipeline',
                      author: pipelineTemplateInfo.created_by,
                    })}
                  </div>
                )}
              </div>
            </div>
            <p className="px-4 pt-1 pb-2 system-sm-regular text-text-secondary">
              {pipelineTemplateInfo.description}
            </p>
            <div className="p-3">
              <Button variant="primary" onClick={onApplyTemplate} className="w-full">
                <RiAddLine className="size-4" />
                <span>{t(($) => $['operations.useTemplate'], { ns: 'datasetPipeline' })}</span>
              </Button>
            </div>
            <div className="flex flex-col gap-y-1 px-4 py-2">
              <div className="flex h-6 items-center gap-x-0.5">
                <span
                  id={structureLabelId}
                  className="system-sm-semibold-uppercase text-text-secondary"
                >
                  {t(($) => $['details.structure'], { ns: 'datasetPipeline' })}
                </span>
                <Infotip>
                  <InfotipTrigger aria-labelledby={structureLabelId} />
                  <InfotipContent aria-labelledby={structureLabelId} className="max-w-60">
                    {t(($) => $['details.structureTooltip'], { ns: 'datasetPipeline' })}
                  </InfotipContent>
                </Infotip>
              </div>
              <ChunkStructureCard {...chunkStructureConfig[pipelineTemplateInfo.chunk_structure]} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <LoadingPlaceholder className="h-full" />
        </>
      )}
    </>
  )
}

export default React.memo(Details)
