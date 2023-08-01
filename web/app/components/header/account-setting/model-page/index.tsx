import { useTranslation } from 'react-i18next'
import ModelSelector from './model-selector'

const ModelPage = () => {
  const { t } = useTranslation()

  return (
    <div className='pt-1'>
      <div className='grid grid-cols-2 gap-4'>
        <div className='w-full'>
          <div className='py-2 text-sm font-medium text-gray-900'>
            {t('common.modelProvider.systemReasoningModel.key')}
          </div>
          <div>
            <ModelSelector />
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModelPage
