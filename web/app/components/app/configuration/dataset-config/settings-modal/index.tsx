import type { FC } from 'react'
import { useRef, useState } from 'react'
import { useClickAway } from 'ahooks'
import { useTranslation } from 'react-i18next'
import IndexMethodRadio from '@/app/components/datasets/settings/index-method-radio'
import Button from '@/app/components/base/button'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import type { DataSet } from '@/models/datasets'
import { useToastContext } from '@/app/components/base/toast'
import { updateDatasetSetting } from '@/service/datasets'
import { useModalContext } from '@/context/modal-context'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import type { RetrievalConfig } from '@/types/app'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import { useProviderContext } from '@/context/provider-context'
import { ensureRerankModelSelected, isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'

type SettingsModalProps = {
  currentDataset: DataSet
  onCancel: () => void
  onSave: (newDataset: DataSet) => void
}

const rowClass = `
  flex justify-between py-4
`
const labelClass = `
  flex items-start w-[168px]
`

const SettingsModal: FC<SettingsModalProps> = ({
  currentDataset,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const ref = useRef(null)
  useClickAway(() => {
    if (ref)
      onCancel()
  }, ref)

  const indexMethod = currentDataset.indexing_technique
  const { setShowAccountSettingModal } = useModalContext()
  const [loading, setLoading] = useState(false)
  const [localeCurrentDataset, setLocaleCurrentDataset] = useState({ ...currentDataset })
  const [retrievalConfig, setRetrievalConfig] = useState(localeCurrentDataset?.retrieval_model_dict as RetrievalConfig)

  const {
    rerankDefaultModel,
    isRerankDefaultModelVaild,
  } = useProviderContext()

  const handleValueChange = (type: string, value: string) => {
    setLocaleCurrentDataset({ ...localeCurrentDataset, [type]: value })
  }

  const handleSave = async () => {
    if (loading)
      return
    if (!localeCurrentDataset.name?.trim()) {
      notify({ type: 'error', message: t('datasetSettings.form.nameError') })
      return
    }
    if (
      !isReRankModelSelected({
        rerankDefaultModel,
        isRerankDefaultModelVaild,
        retrievalConfig,
        indexMethod,
      })
    ) {
      notify({ type: 'error', message: t('appDebug.datasetConfig.rerankModelRequired') })
      return
    }
    const postRetrievalConfig = ensureRerankModelSelected({
      rerankDefaultModel: rerankDefaultModel!,
      retrievalConfig,
      indexMethod,
    })
    try {
      setLoading(true)
      const { id, name, description, indexing_technique } = localeCurrentDataset
      await updateDatasetSetting({
        datasetId: id,
        body: {
          name,
          description,
          indexing_technique,
          retrieval_model: postRetrievalConfig,
        },
      })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onSave(localeCurrentDataset)
    }
    catch (e) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <div
      className='fixed top-16 right-2 flex flex-col bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl z-10'
      style={{
        zIndex: 11,
        width: 632,
        height: 'calc(100vh - 72px)',
      }}
      ref={ref}
    >
      <div className='shrink-0 flex justify-between items-center pl-6 pr-5 h-14 border-b border-b-gray-100'>
        <div className='flex flex-col text-base font-semibold text-gray-900'>
          <div className='leading-6'>{t('datasetSettings.title')}</div>
          <a href='' className='leading-[18px] text-xs font-medium text-[#155eef]'>{'Current dataset name'}</a>
        </div>
        <div className='flex items-center'>
          <div
            onClick={onCancel}
            className='flex justify-center items-center w-6 h-6 cursor-pointer'
          >
            <XClose className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
      {/* Body */}
      <div className='p-6 border-b overflow-y-auto pb-[68px]' style={{
        borderBottom: 'rgba(0, 0, 0, 0.05)',
      }}>
        <div className='py-2'>
          <div className='leading-9 text-sm font-medium text-gray-900'>
            {t('datasetSettings.form.name')}
          </div>
          <input
            value={localeCurrentDataset.name}
            onChange={e => handleValueChange('name', e.target.value)}
            className='block px-3 w-full h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
            placeholder={t('datasetSettings.form.namePlaceholder') || ''}
          />
        </div>
        <div className='py-2'>
          <div className='flex justify-between items-center mb-1 h-5 text-sm font-medium text-gray-900'>
            {t('datasetSettings.form.desc')}
          </div>
          <div className='mb-2 text-xs text-gray-500'>
            {t('datasetSettings.form.descInfo')}<a href='/' className='text-primary-600'>{t('common.operation.learnMore')}</a>
          </div>
          <textarea
            value={localeCurrentDataset.description || ''}
            onChange={e => handleValueChange('description', e.target.value)}
            className='block px-3 py-2 w-full h-[88px] rounded-lg bg-gray-100 text-sm outline-none appearance-none resize-none'
            placeholder={t('datasetSettings.form.descPlaceholder') || ''}
          />
        </div>
        <div className='py-2'>
          <div className='leading-9 text-sm font-medium text-gray-900'>
            {t('datasetSettings.form.indexMethod')}
          </div>
          <div>
            <IndexMethodRadio
              disable={!localeCurrentDataset?.embedding_available}
              value={localeCurrentDataset.indexing_technique}
              onChange={v => handleValueChange('indexing_technique', v!)}
              itemClassName='!w-[282px]'
            />
          </div>
        </div>
        <div className='py-2'>
          <div className='leading-9 text-sm font-medium text-gray-900'>
            {t('datasetSettings.form.embeddingModel')}
          </div>
          <div className='w-full h-9 rounded-lg bg-gray-100 opacity-60'>
            <ModelSelector
              readonly
              value={{
                providerName: localeCurrentDataset.embedding_model_provider as ProviderEnum,
                modelName: localeCurrentDataset.embedding_model,
              }}
              modelType={ModelType.embeddings}
              onChange={() => {}}
            />
          </div>
          <div className='mt-2 w-full text-xs leading-6 text-gray-500'>
            {t('datasetSettings.form.embeddingModelTip')}
            <span className='text-[#155eef] cursor-pointer' onClick={() => setShowAccountSettingModal({ payload: 'provider' })}>{t('datasetSettings.form.embeddingModelTipLink')}</span>
          </div>
        </div>
        {/* Retrieval Method Config */}
        <div className={rowClass}>
          <div className={labelClass}>
            <div>
              <div>{t('datasetSettings.form.retrievalSetting.title')}</div>
              <div className='leading-[18px] text-xs font-normal text-gray-500'>
                <a href='' className='text-[#155eef]'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
                {t('datasetSettings.form.retrievalSetting.description')}
              </div>
            </div>
          </div>
          <div className='w-[480px]'>
            {indexMethod === 'high_quality'
              ? (
                <RetrievalMethodConfig
                  value={retrievalConfig}
                  onChange={setRetrievalConfig}
                />
              )
              : (
                <EconomicalRetrievalMethodConfig
                  value={retrievalConfig}
                  onChange={setRetrievalConfig}
                />
              )}
          </div>
        </div>
      </div>
      <div
        className='absolute z-10 bottom-0 w-full flex justify-end py-4 px-6 border-t bg-white '
        style={{
          borderColor: 'rgba(0, 0, 0, 0.05)',
        }}
      >
        <Button
          onClick={onCancel}
          className='mr-2 text-sm font-medium'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          type='primary'
          className='text-sm font-medium'
          disabled={loading}
          onClick={handleSave}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </div>
  )
}

export default SettingsModal
