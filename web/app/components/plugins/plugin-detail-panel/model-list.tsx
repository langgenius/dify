import React from 'react'
import { useTranslation } from 'react-i18next'
// import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
// import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'

const ModelList = () => {
  const { t } = useTranslation()

  return (
    <div className='px-4 py-2'>
      <div className='mb-1 h-6 flex items-center text-text-secondary system-sm-semibold-uppercase'>{t('plugin.detailPanel.modelNum', { num: 3 })}</div>
      <div className='h-8 flex items-center'>
        {/* <ModelIcon
          className='shrink-0 mr-2'
          provider={provider}
          modelName={model.model}
        />
        <ModelName
          className='grow text-sm font-normal text-gray-900'
          modelItem={model}
          showModelType
          showMode
          showContextSize
        >
        </ModelName> */}
      </div>
    </div>
  )
}

export default ModelList
