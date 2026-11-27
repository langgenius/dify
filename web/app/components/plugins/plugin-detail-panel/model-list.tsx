import type { PluginDetail } from '@/app/components/plugins/types'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

type Props = Readonly<{
  detail: PluginDetail
}>

const ModelList = ({ detail }: Props) => {
  const { t } = useTranslation(['plugin', 'common'])
  const modelsQuery = useQuery(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryOptions({
      input: { params: { provider: `${detail.plugin_id}/${detail.declaration.model.provider}` } },
    }),
  )
  const { data: res } = modelsQuery
  const modelsLoad = useOwnedQueryError(modelsQuery)
  const loadErrorMessage = useRequestErrorMessage(modelsLoad?.error)

  if (modelsLoad && loadErrorMessage) {
    return (
      <div className="px-4 py-2">
        <Alert type="error">
          <AlertTitle>{loadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button size="small" loading={modelsLoad.retrying} onClick={modelsLoad.retry}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )
  }

  if (!res) return null

  return (
    <div className="px-4 py-2">
      <div className="mb-1 flex h-6 items-center system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['detailPanel.modelNum'], { ns: 'plugin', num: res.data.length })}
      </div>
      <div className="flex flex-col">
        {res.data.map((model) => (
          <div key={model.model} className="flex h-6 items-center py-1">
            <ModelIcon
              className="me-2 shrink-0"
              provider={(model as any).provider}
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
        ))}
      </div>
    </div>
  )
}

export default ModelList
