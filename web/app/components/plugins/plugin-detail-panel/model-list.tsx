import React from 'react'
import { useTranslation } from 'react-i18next'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import { useModelProviderModelList } from '@/service/use-models'
import type { PluginDetail } from '@/app/components/plugins/types'

type Props = {
  detail: PluginDetail
}

const ModelList = ({
  detail,
}: Props) => {
  const { t } = useTranslation()
  const { data: res } = useModelProviderModelList(`${detail.plugin_id}/${detail.declaration.model.provider}`)

  if (!res)
    return null

  return (
    <div className='px-4 py-2'>
      <div className='mb-1 h-6 flex items-center text-text-secondary system-sm-semibold-uppercase'>{t('plugin.detailPanel.modelNum', { num: res.data.length })}</div>
      <div className='flex flex-col'>
        {res.data.map(model => (
          <div key={model.model} className='h-6 py-1 flex items-center'>
            <ModelIcon
              className='shrink-0 mr-2'
              provider={(model as any).provider}
              modelName={model.model}
            />
            <ModelName
              className='grow text-text-secondary system-md-regular'
              modelItem={model}
              showModelType
              showMode
              showContextSize
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default ModelList
