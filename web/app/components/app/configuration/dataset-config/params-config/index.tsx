'use client'
import type { FC } from 'react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import ConfigContext from '@/context/debug-configuration'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import RadioCard from '@/app/components/base/radio-card/simple'
import { RETRIEVE_TYPE } from '@/types/app'
import Toast from '@/app/components/base/toast'
import { DATASET_DEFAULT } from '@/config'
import {
  MultiPathRetrieval,
  NTo1Retrieval,
} from '@/app/components/base/icons/src/public/common'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'

const ParamsConfig: FC = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    datasetConfigs,
    setDatasetConfigs,
  } = useContext(ConfigContext)
  const [tempDataSetConfigs, setTempDataSetConfigs] = useState(datasetConfigs)

  const type = tempDataSetConfigs.retrieval_model
  const setType = (value: RETRIEVE_TYPE) => {
    setTempDataSetConfigs({
      ...tempDataSetConfigs,
      retrieval_model: value,
    })
  }
  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
    currentModel: isRerankDefaultModelVaild,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(3)

  const rerankModel = (() => {
    if (tempDataSetConfigs.reranking_model) {
      return {
        provider_name: tempDataSetConfigs.reranking_model.reranking_provider_name,
        model_name: tempDataSetConfigs.reranking_model.reranking_model_name,
      }
    }
    else if (rerankDefaultModel) {
      return {
        provider_name: rerankDefaultModel.provider.provider,
        model_name: rerankDefaultModel.model,
      }
    }
  })()

  const handleParamChange = (key: string, value: number) => {
    if (key === 'top_k') {
      setTempDataSetConfigs({
        ...tempDataSetConfigs,
        top_k: value,
      })
    }
    else if (key === 'score_threshold') {
      setTempDataSetConfigs({
        ...tempDataSetConfigs,
        score_threshold: value,
      })
    }
  }

  const handleSwitch = (key: string, enable: boolean) => {
    if (key === 'top_k')
      return

    setTempDataSetConfigs({
      ...tempDataSetConfigs,
      score_threshold_enabled: enable,
    })
  }
  const isValid = () => {
    let errMsg = ''
    if (tempDataSetConfigs.retrieval_model === RETRIEVE_TYPE.multiWay) {
      if (!tempDataSetConfigs.reranking_model?.reranking_model_name && (!rerankDefaultModel && isRerankDefaultModelVaild))
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
    setOpen(false)
  }

  return (
    <div>
      <div
        className={cn('flex items-center rounded-md h-7 px-3 space-x-1 text-gray-700 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}
        onClick={() => {
          setTempDataSetConfigs({
            ...datasetConfigs,
            top_k: datasetConfigs.top_k || DATASET_DEFAULT.top_k,
            score_threshold: datasetConfigs.score_threshold || DATASET_DEFAULT.score_threshold,
          })
          setOpen(true)
        }}
      >
        <Settings04 className="w-[14px] h-[14px]" />
        <div className='text-xs font-medium'>
          {t('appDebug.datasetConfig.params')}
        </div>
      </div>
      {
        open && (
          <Modal
            isShow={open}
            onClose={() => {
              setOpen(false)
            }}
            className='sm:min-w-[528px]'
            wrapperClassName='z-50'
            title={t('appDebug.datasetConfig.settingTitle')}
          >
            <div className='mt-2 space-y-3'>
              <RadioCard
                icon={<NTo1Retrieval className='shrink-0 mr-3 w-9 h-9 rounded-lg' />}
                title={t('appDebug.datasetConfig.retrieveOneWay.title')}
                description={t('appDebug.datasetConfig.retrieveOneWay.description')}
                isChosen={type === RETRIEVE_TYPE.oneWay}
                onChosen={() => { setType(RETRIEVE_TYPE.oneWay) }}
              />
              <RadioCard
                icon={<MultiPathRetrieval className='shrink-0 mr-3 w-9 h-9 rounded-lg' />}
                title={t('appDebug.datasetConfig.retrieveMultiWay.title')}
                description={t('appDebug.datasetConfig.retrieveMultiWay.description')}
                isChosen={type === RETRIEVE_TYPE.multiWay}
                onChosen={() => { setType(RETRIEVE_TYPE.multiWay) }}
              />
            </div>
            {type === RETRIEVE_TYPE.multiWay && (
              <>
                <div className='mt-6'>
                  <div className='leading-[32px] text-[13px] font-medium text-gray-900'>{t('common.modelProvider.rerankModel.key')}</div>
                  <div>
                    <ModelSelector
                      defaultModel={rerankModel && { provider: rerankModel?.provider_name, model: rerankModel?.model_name }}
                      onSelect={(v) => {
                        setTempDataSetConfigs({
                          ...tempDataSetConfigs,
                          reranking_model: {
                            reranking_provider_name: v.provider,
                            reranking_model_name: v.model,
                          },
                        })
                      }}
                      modelList={rerankModelList}
                    />
                  </div>
                </div>
                <div className='mt-4 space-y-4'>
                  <TopKItem
                    value={tempDataSetConfigs.top_k}
                    onChange={handleParamChange}
                    enable={true}
                  />
                  <ScoreThresholdItem
                    value={tempDataSetConfigs.score_threshold}
                    onChange={handleParamChange}
                    enable={tempDataSetConfigs.score_threshold_enabled}
                    hasSwitch={true}
                    onSwitchChange={handleSwitch}
                  />
                </div>
              </>
            )}
            <div className='mt-6 flex justify-end'>
              <Button className='mr-2 flex-shrink-0' onClick={() => {
                setOpen(false)
              }}>{t('common.operation.cancel')}</Button>
              <Button type='primary' className='flex-shrink-0' onClick={handleSave} >{t('common.operation.save')}</Button>
            </div>
          </Modal>
        )
      }

    </div>
  )
}
export default memo(ParamsConfig)
