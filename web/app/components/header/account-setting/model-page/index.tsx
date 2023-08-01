import { useTranslation } from 'react-i18next'
import ModelSelector from './model-selector'
import ModelCard from './model-card'

const ModelPage = () => {
  const { t } = useTranslation()

  return (
    <div className='pt-1'>
      <div className='grid grid-cols-2 gap-4 mb-4'>
        <div className='w-full'>
          <div className='py-2 text-sm font-medium text-gray-900'>
            {t('common.modelProvider.systemReasoningModel.key')}
          </div>
          <div>
            <ModelSelector />
          </div>
        </div>
      </div>
      <div className='mb-4 h-[0.5px] bg-gray-100' />
      <div className='mb-3 text-sm font-medium text-gray-800'>{t('common.modelProvider.models')}</div>
      <div className='grid grid-cols-2 gap-4 mb-6'>
        <ModelCard />
        <ModelCard type='anthropic' />
      </div>
    </div>
  )
}

export default ModelPage
