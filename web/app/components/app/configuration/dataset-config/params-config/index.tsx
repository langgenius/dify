'use client'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { RiEqualizer2Line } from '@remixicon/react'
import ConfigContent from './config-content'
import cn from '@/utils/classnames'
import ConfigContext from '@/context/debug-configuration'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { RETRIEVE_TYPE } from '@/types/app'
import Toast from '@/app/components/base/toast'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs } from '@/models/debug'
import {
  getMultipleRetrievalConfig,
} from '@/app/components/workflow/nodes/knowledge-retrieval/utils'

type ParamsConfigProps = {
  disabled?: boolean
  selectedDatasets: DataSet[]
}
const ParamsConfig = ({
  disabled,
  selectedDatasets,
}: ParamsConfigProps) => {
  const { t } = useTranslation()
  const {
    datasetConfigs,
    setDatasetConfigs,
    rerankSettingModalOpen,
    setRerankSettingModalOpen,
  } = useContext(ConfigContext)
  const [tempDataSetConfigs, setTempDataSetConfigs] = useState(datasetConfigs)

  useEffect(() => {
    setTempDataSetConfigs(datasetConfigs)
  }, [datasetConfigs])

  const {
    defaultModel: rerankDefaultModel,
    currentModel: isRerankDefaultModelValid,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const isValid = () => {
    let errMsg = ''
    if (tempDataSetConfigs.retrieval_model === RETRIEVE_TYPE.multiWay) {
      if (!tempDataSetConfigs.reranking_model?.reranking_model_name && (rerankDefaultModel && !isRerankDefaultModelValid))
        errMsg = t('appDebug.datasetConfig.rerankModelRequired')
    }
    if (errMsg) {
      Toast.notify({
        type: 'error',
        message: errMsg,
      })
    }
    return !errMsg
  }
  const handleSave = () => {
    if (!isValid())
      return
    const config = { ...tempDataSetConfigs }
    if (config.retrieval_model === RETRIEVE_TYPE.multiWay && !config.reranking_model) {
      config.reranking_model = {
        reranking_provider_name: rerankDefaultModel?.provider?.provider,
        reranking_model_name: rerankDefaultModel?.model,
      } as any
    }
    setDatasetConfigs(config)
    setRerankSettingModalOpen(false)
  }

  const handleSetTempDataSetConfigs = (newDatasetConfigs: DatasetConfigs) => {
    const { datasets, retrieval_model, score_threshold_enabled, ...restConfigs } = newDatasetConfigs

    const retrievalConfig = getMultipleRetrievalConfig({
      top_k: restConfigs.top_k,
      score_threshold: restConfigs.score_threshold,
      reranking_model: restConfigs.reranking_model && {
        provider: restConfigs.reranking_model.reranking_provider_name,
        model: restConfigs.reranking_model.reranking_model_name,
      },
      reranking_mode: restConfigs.reranking_mode,
      weights: restConfigs.weights,
      reranking_enable: restConfigs.reranking_enable,
    }, selectedDatasets, selectedDatasets, !!isRerankDefaultModelValid)

    setTempDataSetConfigs({
      ...retrievalConfig,
      reranking_model: restConfigs.reranking_model && {
        reranking_provider_name: restConfigs.reranking_model.reranking_provider_name,
        reranking_model_name: restConfigs.reranking_model.reranking_model_name,
      },
      retrieval_model,
      score_threshold_enabled,
      datasets,
    })
  }

  return (
    <div>
      <Button
        variant='ghost'
        size='small'
        className={cn('h-7', rerankSettingModalOpen && 'bg-components-button-ghost-bg-hover')}
        onClick={() => {
          setRerankSettingModalOpen(true)
        }}
        disabled={disabled}
      >
        <RiEqualizer2Line className='mr-1 w-3.5 h-3.5' />
        {t('dataset.retrievalSettings')}
      </Button>
      {
        rerankSettingModalOpen && (
          <Modal
            isShow={rerankSettingModalOpen}
            onClose={() => {
              setRerankSettingModalOpen(false)
            }}
            className='sm:min-w-[528px]'
          >
            <ConfigContent
              datasetConfigs={tempDataSetConfigs}
              onChange={handleSetTempDataSetConfigs}
              selectedDatasets={selectedDatasets}
            />

            <div className='mt-6 flex justify-end'>
              <Button className='mr-2 flex-shrink-0' onClick={() => {
                setTempDataSetConfigs(datasetConfigs)
                setRerankSettingModalOpen(false)
              }}>{t('common.operation.cancel')}</Button>
              <Button variant='primary' className='flex-shrink-0' onClick={handleSave} >{t('common.operation.save')}</Button>
            </div>
          </Modal>
        )
      }

    </div>
  )
}
export default memo(ParamsConfig)
