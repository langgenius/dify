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
      <div className='system-sm-semibold-uppercase mb-1 flex h-6 items-center text-text-secondary'>{t('plugin.detailPanel.modelNum', { num: res.data.length })}</div>
      <div className='flex flex-col'>
        {res.data.map(model => (
          <div key={model.model} className='flex h-6 items-center py-1'>
            <ModelIcon
              className='mr-2 shrink-0'
              provider={(model as any).provider}
              modelName={model.model}
            />
            <ModelName
              className='system-md-regular grow text-text-secondary'
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
