import React from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import { fetchModelProviderModelList } from '@/service/common'

const ModelList = () => {
  const { t } = useTranslation()
  const currentPluginDetail = usePluginPageContext(v => v.currentPluginDetail)

  const { data: res } = useSWR(
    `/workspaces/current/model-providers/${currentPluginDetail.plugin_id}/${currentPluginDetail.name}/models`,
    fetchModelProviderModelList,
  )

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
              provider={currentPluginDetail.declaration.model}
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
