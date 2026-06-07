import type { Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { PluginDetail } from '@/app/components/plugins/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import { useModelProviderModelList } from '@/service/use-models'

type Props = {
  detail: PluginDetail
}

const ModelList = ({
  detail,
}: Props) => {
  const { t } = useTranslation()
  const provider = detail.declaration.model?.provider
  const { data: res } = useModelProviderModelList(provider ? `${detail.plugin_id}/${provider}` : '')

  if (!provider || !res)
    return null

  return (
    <div className="px-4 py-2">
      <div className="mb-1 flex h-6 items-center system-sm-semibold-uppercase text-text-secondary">{t('detailPanel.modelNum', { ns: 'plugin', num: res.data.length })}</div>
      <div className="flex flex-col">
        {res.data.map((model) => {
          const modelProvider = 'provider' in model && typeof model.provider === 'string'
            ? model as unknown as Model
            : undefined

          return (
            <div key={model.model} className="flex h-6 items-center py-1">
              <ModelIcon
                className="mr-2 shrink-0"
                provider={modelProvider}
                modelName={model.model}
              />
              <ModelName
                className="grow system-md-regular text-text-secondary"
                modelItem={model}
                showModelType
                showMode
                showContextSize
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ModelList
