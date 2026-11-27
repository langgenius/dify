import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { DialogClose, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { RiAddLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { selectPipelineTemplate } from '@/app/components/rag-pipeline/utils/query-select'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
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

  const { t } = useTranslation(['datasetPipeline', 'common', 'dataset'])
  const templateQuery = useQuery(
    consoleQuery.rag.pipeline.templates.byTemplateId.get.queryOptions({
      input: { params: { template_id: id }, query: { type } },
      select: selectPipelineTemplate,
    }),
  )
  const pipelineTemplateInfo = templateQuery.data
  const templateLoad = useOwnedQueryError(templateQuery)
  const loadErrorMessage = useRequestErrorMessage(
    templateLoad?.error,
    t(($) => $.loadError, { ns: 'dataset' }),
  )

  const chunkStructureConfig = useChunkStructureConfig()

  return (
    <>
      <DialogClose
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            size="lg"
            className="absolute inset-e-4 top-4 z-10"
          >
            <span className="i-ri-close-line size-4 text-text-tertiary" aria-hidden />
          </IconButton>
        }
      />
      {pipelineTemplateInfo ? (
        <div className="flex h-full">
          <div className="flex grow items-center justify-center p-3 pe-0">
            <WorkflowPreview
              {...pipelineTemplateInfo.graph}
              className="overflow-hidden rounded-2xl"
            />
          </div>
          <div className="relative flex w-90 shrink-0 flex-col">
            <div className="flex items-start gap-x-3 ps-4 pe-12 pt-6 pb-2">
              <AppIcon size="large" icon={pipelineTemplateInfo.icon_info} />
              <div className="flex grow flex-col gap-y-1 overflow-hidden py-px">
                <DialogTitle
                  // oxlint-disable-next-line shadcn/no-restyle -- Full-page template header keeps its compact template name.
                  className="truncate text-sm/5 text-text-secondary"
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
      ) : templateLoad ? (
        <div className="flex h-full flex-col items-center justify-center p-6">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <Alert type="error" className="w-full max-w-120">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button size="small" loading={templateLoad.retrying} onClick={templateLoad.retry}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
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
