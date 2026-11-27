import type { PluginDetail } from '@/app/components/plugins/types'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { skipToken, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import StrategyItem from '@/app/components/plugins/plugin-detail-panel/strategy-item'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

type Props = Readonly<{
  detail: PluginDetail
}>

const AgentStrategyList = ({ detail }: Props) => {
  const { t } = useTranslation(['plugin', 'common'])
  const providerName = detail.declaration.agent_strategy?.identity.name
  const strategyProviderQuery = useQuery(
    consoleQuery.workspaces.current.agentProvider.byProviderName.get.queryOptions({
      input: providerName
        ? { params: { provider_name: `${detail.plugin_id}/${providerName}` } }
        : skipToken,
    }),
  )
  const { data: strategyProviderDetail } = strategyProviderQuery
  const strategyProviderLoad = useOwnedQueryError(strategyProviderQuery)
  const loadErrorMessage = useRequestErrorMessage(strategyProviderLoad?.error)

  if (strategyProviderLoad && loadErrorMessage) {
    return (
      <div className="px-4 pt-2 pb-4">
        <Alert type="error">
          <AlertTitle>{loadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button
              size="small"
              loading={strategyProviderLoad.retrying}
              onClick={strategyProviderLoad.retry}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )
  }

  if (!strategyProviderDetail) return null
  const strategyList = strategyProviderDetail.declaration.strategies ?? []

  return (
    <div className="px-4 pt-2 pb-4">
      <div className="mb-1 py-1">
        <div className="mb-1 flex h-6 items-center justify-between system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['detailPanel.strategyNum'], {
            ns: 'plugin',
            num: strategyList.length,
            strategy: strategyList.length > 1 ? 'strategies' : 'strategy',
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {strategyList.map((strategyDetail) => (
          <StrategyItem
            key={`${strategyDetail.identity.provider}${strategyDetail.identity.name}`}
            provider={strategyProviderDetail.declaration.identity}
            tenantId={detail.tenant_id}
            detail={strategyDetail}
          />
        ))}
      </div>
    </div>
  )
}

export default AgentStrategyList
