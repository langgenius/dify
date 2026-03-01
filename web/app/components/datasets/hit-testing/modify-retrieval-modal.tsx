'use client'
import type { FC } from 'react'
import type { IndexingType } from '../create/step-two'
import type { RetrievalConfig } from '@/types/app'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDocLink } from '@/context/i18n'
import Toast from '../../base/toast'
import { ModelTypeEnum } from '../../header/account-setting/model-provider-page/declarations'
import { checkShowMultiModalTip } from '../settings/utils'

type Props = {
  indexMethod: string
  value: RetrievalConfig
  isShow: boolean
  onHide: () => void
  onSave: (value: RetrievalConfig) => void
}

const ModifyRetrievalModal: FC<Props> = ({
  indexMethod,
  value,
  isShow,
  onHide,
  onSave,
}) => {
  const ref = useRef(null)
  const { t } = useTranslation()
  const docLink = useDocLink()
  const [retrievalConfig, setRetrievalConfig] = useState(value)
  const embeddingModel = useDatasetDetailContextWithSelector(state => state.dataset?.embedding_model)
  const embeddingModelProvider = useDatasetDetailContextWithSelector(state => state.dataset?.embedding_model_provider)

  // useClickAway(() => {
  //   if (ref)
  //     onHide()
  // }, ref)

  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: rerankModelList } = useModelList(ModelTypeEnum.rerank)

  const handleSave = () => {
    if (
      !isReRankModelSelected({
        rerankModelList,
        retrievalConfig,
        indexMethod,
      })
    ) {
      Toast.notify({ type: 'error', message: t('datasetConfig.rerankModelRequired', { ns: 'appDebug' }) })
      return
    }
    onSave(retrievalConfig)
  }

  const showMultiModalTip = useMemo(() => {
    return checkShowMultiModalTip({
      embeddingModel: {
        provider: embeddingModelProvider ?? '',
        model: embeddingModel ?? '',
      },
      rerankingEnable: retrievalConfig.reranking_enable,
      rerankModel: {
        rerankingProviderName: retrievalConfig.reranking_model.reranking_provider_name,
        rerankingModelName: retrievalConfig.reranking_model.reranking_model_name,
      },
      indexMethod: indexMethod as IndexingType,
      embeddingModelList,
      rerankModelList,
    })
  }, [embeddingModelProvider, embeddingModel, retrievalConfig.reranking_enable, retrievalConfig.reranking_model, indexMethod, embeddingModelList, rerankModelList])

  if (!isShow)
    return null

  return (
    <div
      className="flex w-full flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9"
      style={{
        height: 'calc(100vh - 72px)',
      }}
      ref={ref}
    >
      <div className="h-15 flex shrink-0 justify-between px-3 pb-1 pt-3.5">
        <div className="text-base font-semibold text-text-primary">
          <div>{t('form.retrievalSetting.title', { ns: 'datasetSettings' })}</div>
          <div className="text-xs font-normal leading-[18px] text-text-tertiary">
            <a
              target="_blank"
              rel="noopener noreferrer"
              href={docLink('/use-dify/knowledge/create-knowledge/setting-indexing-methods')}
              className="text-text-accent"
            >
              {t('form.retrievalSetting.learnMore', { ns: 'datasetSettings' })}
            </a>
            {t('form.retrievalSetting.description', { ns: 'datasetSettings' })}
          </div>
        </div>
        <div className="flex">
          <div
            onClick={onHide}
            className="flex h-8 w-8 cursor-pointer items-center justify-center"
          >
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>

      <div className="px-4 py-2">
        <div className="mb-1 text-[13px] font-semibold leading-6 text-text-secondary">
          {t('form.retrievalSetting.method', { ns: 'datasetSettings' })}
        </div>
        {indexMethod === 'high_quality'
          ? (
              <RetrievalMethodConfig
                value={retrievalConfig}
                onChange={setRetrievalConfig}
                showMultiModalTip={showMultiModalTip}
              />
            )
          : (
              <EconomicalRetrievalMethodConfig
                value={retrievalConfig}
                onChange={setRetrievalConfig}
              />
            )}
      </div>
      <div className="flex justify-end p-4 pt-2">
        <Button className="mr-2 shrink-0" onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button variant="primary" className="shrink-0" onClick={handleSave}>{t('operation.save', { ns: 'common' })}</Button>
      </div>
    </div>
  )
}
export default React.memo(ModifyRetrievalModal)
