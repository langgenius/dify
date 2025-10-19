'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { RiEqualizer2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type { MultipleRetrievalConfig, SingleRetrievalConfig } from '../types'
import type { ModelConfig } from '../../../types'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ConfigRetrievalContent from '@/app/components/app/configuration/dataset-config/params-config/config-content'
import { RETRIEVE_TYPE } from '@/types/app'
import { DATASET_DEFAULT } from '@/config'
import Button from '@/app/components/base/button'
import type { DatasetConfigs } from '@/models/debug'
import type { DataSet } from '@/models/datasets'

type Props = {
  payload: {
    retrieval_mode: RETRIEVE_TYPE
    multiple_retrieval_config?: MultipleRetrievalConfig
    single_retrieval_config?: SingleRetrievalConfig
  }
  onRetrievalModeChange: (mode: RETRIEVE_TYPE) => void
  onMultipleRetrievalConfigChange: (config: MultipleRetrievalConfig) => void
  singleRetrievalModelConfig?: ModelConfig
  onSingleRetrievalModelChange?: (config: ModelConfig) => void
  onSingleRetrievalModelParamsChange?: (config: ModelConfig) => void
  readonly?: boolean
  rerankModalOpen: boolean
  onRerankModelOpenChange: (open: boolean) => void
  selectedDatasets: DataSet[]
}

const RetrievalConfig: FC<Props> = ({
  payload,
  onRetrievalModeChange,
  onMultipleRetrievalConfigChange,
  singleRetrievalModelConfig,
  onSingleRetrievalModelChange,
  onSingleRetrievalModelParamsChange,
  readonly,
  rerankModalOpen,
  onRerankModelOpenChange,
  selectedDatasets,
}) => {
  const { t } = useTranslation()
  const { retrieval_mode, multiple_retrieval_config } = payload

  const handleOpen = useCallback((newOpen: boolean) => {
    onRerankModelOpenChange(newOpen)
  }, [onRerankModelOpenChange])

  const datasetConfigs = useMemo(() => {
    const {
      reranking_model,
      top_k,
      score_threshold,
      reranking_mode,
      weights,
      reranking_enable,
    } = multiple_retrieval_config || {}

    return {
      retrieval_model: retrieval_mode,
      reranking_model: (reranking_model?.provider && reranking_model?.model)
        ? {
          reranking_provider_name: reranking_model?.provider,
          reranking_model_name: reranking_model?.model,
        }
        : {
          reranking_provider_name: '',
          reranking_model_name: '',
        },
      top_k: top_k || DATASET_DEFAULT.top_k,
      score_threshold_enabled: !(score_threshold === undefined || score_threshold === null),
      score_threshold,
      datasets: {
        datasets: [],
      },
      reranking_mode,
      weights,
      reranking_enable,
    }
  }, [retrieval_mode, multiple_retrieval_config])

  const handleChange = useCallback((configs: DatasetConfigs, isRetrievalModeChange?: boolean) => {
    // Legacy code, for compatibility, have to keep it
    if (isRetrievalModeChange) {
      onRetrievalModeChange(configs.retrieval_model)
      return
    }
    onMultipleRetrievalConfigChange({
      top_k: configs.top_k,
      score_threshold: configs.score_threshold_enabled ? (configs.score_threshold ?? DATASET_DEFAULT.score_threshold) : null,
      reranking_model: retrieval_mode === RETRIEVE_TYPE.oneWay
        ? undefined
        // eslint-disable-next-line sonarjs/no-nested-conditional
        : (!configs.reranking_model?.reranking_provider_name
          ? undefined
          : {
            provider: configs.reranking_model?.reranking_provider_name,
            model: configs.reranking_model?.reranking_model_name,
          }),
      reranking_mode: configs.reranking_mode,
      weights: configs.weights,
      reranking_enable: configs.reranking_enable,
    })
  }, [onMultipleRetrievalConfigChange, retrieval_mode, onRetrievalModeChange])

  return (
    <PortalToFollowElem
      open={rerankModalOpen}
      onOpenChange={handleOpen}
      placement='bottom-end'
      offset={{
        crossAxis: -2,
      }}
    >
      <PortalToFollowElemTrigger
        onClick={() => {
          if (readonly)
            return
          handleOpen(!rerankModalOpen)
        }}
      >
        <Button
          variant='ghost'
          size='small'
          disabled={readonly}
          className={cn(rerankModalOpen && 'bg-components-button-ghost-bg-hover')}
        >
          <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
          {t('dataset.retrievalSettings')}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1001 }}>
        <div className='w-[404px] rounded-2xl border border-components-panel-border bg-components-panel-bg  px-4 pb-4 pt-3  shadow-xl'>
          <ConfigRetrievalContent
            datasetConfigs={datasetConfigs}
            onChange={handleChange}
            selectedDatasets={selectedDatasets}
            isInWorkflow
            singleRetrievalModelConfig={singleRetrievalModelConfig}
            onSingleRetrievalModelChange={onSingleRetrievalModelChange}
            onSingleRetrievalModelParamsChange={onSingleRetrievalModelParamsChange}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(RetrievalConfig)
