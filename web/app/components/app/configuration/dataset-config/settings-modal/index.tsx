import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import IndexMethodRadio from '@/app/components/datasets/settings/index-method-radio'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import type { DataSet } from '@/models/datasets'

type SettingsModalProps = {
  currentDataset: DataSet
  onCancel: () => void
}
const SettingsModal: FC<SettingsModalProps> = ({
  currentDataset,
  onCancel,
}) => {
  const { t } = useTranslation()

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
          className='block px-3 w-full h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
          placeholder={''}
        />
      </div>
      <div className='py-2'>
        <div className='flex justify-between items-center h-9 text-sm font-medium text-gray-900'>
          {t('datasetSettings.form.desc')}
          <a
            href={'/'}
            className='flex items-center text-xs text-gray-500'
          >
            <BookOpen01 className='mr-1 w-3 h-3 text-gray-500' />
            {t('datasetSettings.form.descWrite')}
          </a>
        </div>
        <textarea
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
            disable={!currentDataset?.embedding_available}
            value='high_quality'
            onChange={() => {}}
          />
        </div>
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('datasetSettings.form.embeddingModel')}
        </div>
        <div>
          <ModelSelector
            readonly
            value={{
              providerName: currentDataset.embedding_model_provider as ProviderEnum,
              modelName: currentDataset.embedding_model,
            }}
            modelType={ModelType.embeddings}
            onChange={() => {}}
          />
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
          onClick={() => {}}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </Modal>
  )
}

export default SettingsModal
