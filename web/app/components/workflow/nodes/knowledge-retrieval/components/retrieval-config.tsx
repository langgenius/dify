'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { MultipleRetrievalConfig } from '../types'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ConfigRetrievalContent from '@/app/components/app/configuration/dataset-config/params-config/config-content'
import { RETRIEVE_TYPE } from '@/types/app'

import type {
  DatasetConfigs,
} from '@/models/debug'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'

type Props = {
  payload: {
    retrieval_mode: RETRIEVE_TYPE
    multiple_retrieval_config?: MultipleRetrievalConfig
  }
  onRetrievalModeChange: (mode: RETRIEVE_TYPE) => void
  onMultipleRetrievalConfigChange: (config: MultipleRetrievalConfig) => void
}

const RetrievalConfig: FC<Props> = ({
  payload,
  onRetrievalModeChange,
  onMultipleRetrievalConfigChange,
}) => {
  const { t } = useTranslation()

  const [open, setOpen] = useState(false)

  const { multiple_retrieval_config } = payload
  const handleChange = useCallback((configs: DatasetConfigs, isRetrievalModeChange?: boolean) => {
    if (isRetrievalModeChange) {
      onRetrievalModeChange(configs.retrieval_model)
      return
    }
    onMultipleRetrievalConfigChange({
      top_k: configs.top_k,
      score_threshold: configs.score_threshold_enabled ? configs.score_threshold : null,
      reranking_model: {
        provider: configs.reranking_model?.reranking_provider_name,
        model: configs.reranking_model?.reranking_model_name,
      },
    })
  }, [onRetrievalModeChange, onMultipleRetrievalConfigChange])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        // mainAxis: 12,
        crossAxis: -2,
      }}
    >
      <PortalToFollowElemTrigger
        onClick={() => setOpen(v => !v)}
      >
        <div className={cn(open && 'bg-gray-100', 'flex items-center h-6  px-2 rounded-md hover:bg-gray-100 group cursor-pointer select-none')}>
          <div className={cn(open ? 'text-gray-700' : 'text-gray-500', 'leading-[18px] text-xs font-medium group-hover:bg-gray-100')}>{payload.retrieval_mode === RETRIEVE_TYPE.oneWay ? t('appDebug.datasetConfig.retrieveOneWay.title') : t('appDebug.datasetConfig.retrieveMultiWay.title')}</div>
          <ChevronDown className='ml-1 w-3 h-3' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1001 }}>
        <div className='w-[404px] pt-3 pb-4 px-4 shadow-xl  rounded-2xl border border-gray-200  bg-white'>
          <ConfigRetrievalContent
            datasetConfigs={
              {
                retrieval_model: payload.retrieval_mode,
                reranking_model: {
                  reranking_provider_name: multiple_retrieval_config?.reranking_model?.provider || '',
                  reranking_model_name: multiple_retrieval_config?.reranking_model?.model || '',
                },
                top_k: multiple_retrieval_config?.top_k || 5,
                score_threshold_enabled: !(multiple_retrieval_config?.score_threshold === undefined || multiple_retrieval_config?.score_threshold === null),
                score_threshold: multiple_retrieval_config?.score_threshold || 0.5,
                datasets: {
                  datasets: [],
                },
              }
            }
            onChange={handleChange}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(RetrievalConfig)
