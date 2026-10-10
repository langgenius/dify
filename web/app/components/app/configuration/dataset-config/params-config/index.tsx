'use client'
import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import { toast } from '@/app/components/app/configuration/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useCurrentProviderAndModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { getMultipleRetrievalConfig } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import ConfigContext from '@/context/debug-configuration'
import { RerankingModeEnum } from '@/models/datasets'
import { RETRIEVE_TYPE } from '@/types/app'
import ConfigContent from './config-content'

type ParamsConfigProps = {
  disabled?: boolean
  selectedDatasets: DataSet[]
}
function ParamsConfigForm({
  selectedDatasets,
  open,
}: Pick<ParamsConfigProps, 'selectedDatasets'> & { open: boolean }) {
  const { t } = useTranslation(['appDebug', 'common', 'dataset'])
  const datasetConfigs = useContextSelector(ConfigContext, (context) => context.datasetConfigs)
  const setDatasetConfigs = useContextSelector(
    ConfigContext,
    (context) => context.setDatasetConfigs,
  )
  const setRerankSettingModalOpen = useContextSelector(
    ConfigContext,
    (context) => context.setRerankSettingModalOpen,
  )
  const [sourceConfigs, setSourceConfigs] = useState(datasetConfigs)
  const [tempDataSetConfigs, setTempDataSetConfigs] = useState(datasetConfigs)

  if (open && sourceConfigs !== datasetConfigs) {
    setSourceConfigs(datasetConfigs)
    setTempDataSetConfigs(datasetConfigs)
  }

  const {
    modelList: rerankModelList,
    currentModel: rerankDefaultModel,
    currentProvider: rerankDefaultProvider,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const { currentModel: isCurrentRerankModelValid } = useCurrentProviderAndModel(rerankModelList, {
    provider: tempDataSetConfigs.reranking_model?.reranking_provider_name ?? '',
    model: tempDataSetConfigs.reranking_model?.reranking_model_name ?? '',
  })

  const isValid = () => {
    let errMsg = ''
    if (tempDataSetConfigs.retrieval_model === RETRIEVE_TYPE.multiWay) {
      if (
        tempDataSetConfigs.reranking_enable &&
        tempDataSetConfigs.reranking_mode === RerankingModeEnum.RerankingModel &&
        !isCurrentRerankModelValid
      ) {
        errMsg = t(($) => $['datasetConfig.rerankModelRequired'], { ns: 'appDebug' })
      }
    }
    if (errMsg) {
      toast.error(errMsg)
    }
    return !errMsg
  }
  const handleSave = () => {
    if (!isValid()) return
    setDatasetConfigs(tempDataSetConfigs)
    setRerankSettingModalOpen(false)
  }

  const handleSetTempDataSetConfigs = (newDatasetConfigs: DatasetConfigs) => {
    const { datasets, retrieval_model, score_threshold_enabled, ...restConfigs } = newDatasetConfigs

    const retrievalConfig = getMultipleRetrievalConfig(
      {
        top_k: restConfigs.top_k,
        score_threshold: restConfigs.score_threshold,
        reranking_model: restConfigs.reranking_model && {
          provider: restConfigs.reranking_model.reranking_provider_name,
          model: restConfigs.reranking_model.reranking_model_name,
        },
        reranking_mode: restConfigs.reranking_mode,
        weights: restConfigs.weights,
        reranking_enable: restConfigs.reranking_enable,
      },
      selectedDatasets,
      selectedDatasets,
      {
        provider: rerankDefaultProvider?.provider,
        model: rerankDefaultModel?.model,
      },
    )

    setTempDataSetConfigs({
      ...retrievalConfig,
      reranking_model: {
        reranking_provider_name: retrievalConfig.reranking_model?.provider || '',
        reranking_model_name: retrievalConfig.reranking_model?.model || '',
      },
      retrieval_model,
      score_threshold_enabled,
      datasets,
    })
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        event.stopPropagation()
        handleSave()
      }}
    >
      <DialogTitle className="sr-only">
        {t(($) => $.retrievalSettings, { ns: 'dataset' })}
      </DialogTitle>
      <ConfigContent
        datasetConfigs={tempDataSetConfigs}
        onChange={handleSetTempDataSetConfigs}
        selectedDatasets={selectedDatasets}
      />
      <div className="mt-6 flex justify-end">
        <DialogClose render={<Button className="mr-2 shrink-0" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary" className="shrink-0">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </form>
  )
}

export const ParamsConfig = memo(({ disabled, selectedDatasets }: ParamsConfigProps) => {
  const { t } = useTranslation(['dataset'])
  const rerankSettingModalOpen = useContextSelector(
    ConfigContext,
    (context) => context.rerankSettingModalOpen,
  )
  const setRerankSettingModalOpen = useContextSelector(
    ConfigContext,
    (context) => context.setRerankSettingModalOpen,
  )

  return (
    <div>
      <Dialog open={rerankSettingModalOpen} onOpenChange={setRerankSettingModalOpen}>
        <DialogTrigger
          disabled={disabled}
          render={
            <Button
              variant="ghost"
              size="small"
              className={cn('h-7', rerankSettingModalOpen && 'bg-components-button-ghost-bg-hover')}
            />
          }
        >
          <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
          {t(($) => $.retrievalSettings, { ns: 'dataset' })}
        </DialogTrigger>
        <DialogContent className="w-full max-w-120 border-none text-left align-middle sm:min-w-132">
          <ParamsConfigForm selectedDatasets={selectedDatasets} open={rerankSettingModalOpen} />
        </DialogContent>
      </Dialog>
    </div>
  )
})
