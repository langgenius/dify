import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import IndexMethodRadio from '@/app/components/datasets/settings/index-method-radio'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import type { DataSet } from '@/models/datasets'
import { useToastContext } from '@/app/components/base/toast'
import { updateDatasetSetting } from '@/service/datasets'
import { useModalContext } from '@/context/modal-context'

type SettingsModalProps = {
  currentDataset: DataSet
  onCancel: () => void
  onSave: (newDataset: DataSet) => void
}
const SettingsModal: FC<SettingsModalProps> = ({
  currentDataset,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { setShowAccountSettingModal } = useModalContext()
  const [loading, setLoading] = useState(false)
  const [localeCurrentDataset, setLocaleCurrentDataset] = useState({ ...currentDataset })

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
    try {
      setLoading(true)
      const { id, name, description, indexing_technique } = localeCurrentDataset
      await updateDatasetSetting({
        datasetId: id,
        body: {
          name,
          description,
          indexing_technique,
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
    <Modal
      isShow
      onClose={() => {}}
      className='!p-8 !pb-6 !max-w-none !w-[640px]'
    >
      <div className='mb-2 text-xl font-semibold text-gray-900'>
        {t('datasetSettings.title')}
      </div>
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
      <div></div>
      <div className='flex items-center justify-end mt-6'>
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
    </Modal>
  )
}

export default SettingsModal
