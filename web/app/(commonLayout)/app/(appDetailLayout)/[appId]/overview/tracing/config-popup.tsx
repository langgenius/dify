'use client'
import type { FC, JSX } from 'react'
import type {
  AliyunConfig,
  ArizeConfig,
  DatabricksConfig,
  LangFuseConfig,
  LangSmithConfig,
  MLflowConfig,
  OpikConfig,
  PhoenixConfig,
  TencentConfig,
  WeaveConfig,
} from './type'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { lazy, Suspense, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import ProviderPanel from './provider-panel'
import TracingIcon from './tracing-icon'
import { isTracingProvider, TracingProvider } from './type'

const ProviderConfigModal = lazy(() => import('./provider-config-modal'))

const I18N_PREFIX = 'tracing'

type ConfigLoadErrorProps = {
  loading: boolean
  onRetry: () => void
}

const ConfigLoadError: FC<ConfigLoadErrorProps> = ({ loading, onRetry }) => {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-xl bg-state-destructive-hover px-3 py-2"
    >
      <div className="system-xs-regular text-text-secondary">
        {t(($) => $['dynamicSelect.error'], { ns: 'common' })}
      </div>
      <Button type="button" variant="secondary" size="small" loading={loading} onClick={onRetry}>
        {t(($) => $['operation.retry'], { ns: 'common' })}
      </Button>
    </div>
  )
}

export type PopupProps = {
  appId: string
  readOnly: boolean
  enabled: boolean
  onStatusChange: (enabled: boolean) => void
  chosenProvider: TracingProvider | null
  onChooseProvider: (provider: TracingProvider) => void
  onConfigRemoved: (provider: TracingProvider) => void
}

const ConfigPopup: FC<PopupProps> = ({
  appId,
  readOnly,
  enabled,
  onStatusChange,
  chosenProvider,
  onChooseProvider,
  onConfigRemoved,
}) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const configsQueryOptions = consoleQuery.apps.byAppId.traceConfigs.get.queryOptions({
    input: {
      params: { app_id: appId },
      query: { include_config: true },
    },
  })
  const summaryQueryOptions = consoleQuery.apps.byAppId.traceConfigs.get.queryOptions({
    input: {
      params: { app_id: appId },
      query: { include_config: false },
    },
  })
  const {
    data: tracingConfigs,
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery(configsQueryOptions)
  const configuredProviders = new Set(
    (tracingConfigs?.configured_providers ?? []).filter(isTracingProvider),
  )
  const failedProviders = new Set(
    (tracingConfigs?.configs ?? []).flatMap((config) =>
      config.error && isTracingProvider(config.tracing_provider) ? [config.tracing_provider] : [],
    ),
  )
  const hasConfigLoadErrors = (tracingConfigs?.configs ?? []).some((config) => !!config.error)
  const configsByProvider = Object.fromEntries(
    (tracingConfigs?.configs ?? []).flatMap((config) => {
      if (!isTracingProvider(config.tracing_provider) || !config.tracing_config) return []
      return [[config.tracing_provider, config.tracing_config]]
    }),
  )
  const arizeConfig = (configsByProvider[TracingProvider.arize] as ArizeConfig | undefined) ?? null
  const phoenixConfig =
    (configsByProvider[TracingProvider.phoenix] as PhoenixConfig | undefined) ?? null
  const langSmithConfig =
    (configsByProvider[TracingProvider.langSmith] as LangSmithConfig | undefined) ?? null
  const langFuseConfig =
    (configsByProvider[TracingProvider.langfuse] as LangFuseConfig | undefined) ?? null
  const opikConfig = (configsByProvider[TracingProvider.opik] as OpikConfig | undefined) ?? null
  const weaveConfig = (configsByProvider[TracingProvider.weave] as WeaveConfig | undefined) ?? null
  const aliyunConfig =
    (configsByProvider[TracingProvider.aliyun] as AliyunConfig | undefined) ?? null
  const mlflowConfig =
    (configsByProvider[TracingProvider.mlflow] as MLflowConfig | undefined) ?? null
  const databricksConfig =
    (configsByProvider[TracingProvider.databricks] as DatabricksConfig | undefined) ?? null
  const tencentConfig =
    (configsByProvider[TracingProvider.tencent] as TencentConfig | undefined) ?? null

  const [currentProvider, setCurrentProvider] = useState<TracingProvider | null>(
    TracingProvider.langfuse,
  )
  const [isShowConfigModal, { setTrue: showConfigModal, setFalse: hideConfigModal }] =
    useBoolean(false)
  const handleOnConfig = useCallback(
    (provider: TracingProvider) => {
      return () => {
        setCurrentProvider(provider)
        showConfigModal()
      }
    },
    [showConfigModal],
  )

  const handleOnChoose = useCallback(
    (provider: TracingProvider) => {
      return () => {
        onChooseProvider(provider)
      }
    },
    [onChooseProvider],
  )

  const refreshDetailedConfigs = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: configsQueryOptions.queryKey,
    })
  }, [configsQueryOptions.queryKey, queryClient])

  const handleConfigUpdated = useCallback(() => {
    queryClient.setQueryData(summaryQueryOptions.queryKey, (current) => {
      if (!current || !currentProvider) return current
      const configuredProviders = current.configured_providers ?? []
      if (configuredProviders.includes(currentProvider)) return current
      return {
        ...current,
        configured_providers: [...configuredProviders, currentProvider],
      }
    })
    refreshDetailedConfigs()
    hideConfigModal()
  }, [
    currentProvider,
    hideConfigModal,
    queryClient,
    refreshDetailedConfigs,
    summaryQueryOptions.queryKey,
  ])

  const handleConfigRemoved = useCallback(() => {
    queryClient.setQueryData(summaryQueryOptions.queryKey, (current) =>
      current
        ? {
            ...current,
            configured_providers: (current.configured_providers ?? []).filter(
              (provider) => provider !== currentProvider,
            ),
          }
        : current,
    )
    refreshDetailedConfigs()
    onConfigRemoved(currentProvider!)
    hideConfigModal()
  }, [
    currentProvider,
    hideConfigModal,
    onConfigRemoved,
    queryClient,
    refreshDetailedConfigs,
    summaryQueryOptions.queryKey,
  ])

  if (isPending) {
    return (
      <div className="w-105 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-xl">
        <Loading />
      </div>
    )
  }
  if (isError && !tracingConfigs) {
    return (
      <div className="w-105 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-xl">
        <ConfigLoadError loading={isFetching} onRetry={() => void refetch()} />
      </div>
    )
  }

  const providerAllConfigured = Object.values(TracingProvider).every((provider) =>
    configuredProviders.has(provider),
  )
  const providerAllNotConfigured = configuredProviders.size === 0

  const switchContent = (
    <Switch
      className="ml-3"
      checked={enabled}
      onCheckedChange={onStatusChange}
      disabled={providerAllNotConfigured}
    />
  )
  const arizePanel = (
    <ProviderPanel
      type={TracingProvider.arize}
      readOnly={readOnly || failedProviders.has(TracingProvider.arize)}
      config={arizeConfig}
      hasConfigured={configuredProviders.has(TracingProvider.arize)}
      onConfig={handleOnConfig(TracingProvider.arize)}
      isChosen={chosenProvider === TracingProvider.arize}
      onChoose={handleOnChoose(TracingProvider.arize)}
      key="arize-provider-panel"
    />
  )

  const phoenixPanel = (
    <ProviderPanel
      type={TracingProvider.phoenix}
      readOnly={readOnly || failedProviders.has(TracingProvider.phoenix)}
      config={phoenixConfig}
      hasConfigured={configuredProviders.has(TracingProvider.phoenix)}
      onConfig={handleOnConfig(TracingProvider.phoenix)}
      isChosen={chosenProvider === TracingProvider.phoenix}
      onChoose={handleOnChoose(TracingProvider.phoenix)}
      key="phoenix-provider-panel"
    />
  )

  const langSmithPanel = (
    <ProviderPanel
      type={TracingProvider.langSmith}
      readOnly={readOnly || failedProviders.has(TracingProvider.langSmith)}
      config={langSmithConfig}
      hasConfigured={configuredProviders.has(TracingProvider.langSmith)}
      onConfig={handleOnConfig(TracingProvider.langSmith)}
      isChosen={chosenProvider === TracingProvider.langSmith}
      onChoose={handleOnChoose(TracingProvider.langSmith)}
      key="langSmith-provider-panel"
    />
  )

  const langfusePanel = (
    <ProviderPanel
      type={TracingProvider.langfuse}
      readOnly={readOnly || failedProviders.has(TracingProvider.langfuse)}
      config={langFuseConfig}
      hasConfigured={configuredProviders.has(TracingProvider.langfuse)}
      onConfig={handleOnConfig(TracingProvider.langfuse)}
      isChosen={chosenProvider === TracingProvider.langfuse}
      onChoose={handleOnChoose(TracingProvider.langfuse)}
      key="langfuse-provider-panel"
    />
  )

  const opikPanel = (
    <ProviderPanel
      type={TracingProvider.opik}
      readOnly={readOnly || failedProviders.has(TracingProvider.opik)}
      config={opikConfig}
      hasConfigured={configuredProviders.has(TracingProvider.opik)}
      onConfig={handleOnConfig(TracingProvider.opik)}
      isChosen={chosenProvider === TracingProvider.opik}
      onChoose={handleOnChoose(TracingProvider.opik)}
      key="opik-provider-panel"
    />
  )

  const weavePanel = (
    <ProviderPanel
      type={TracingProvider.weave}
      readOnly={readOnly || failedProviders.has(TracingProvider.weave)}
      config={weaveConfig}
      hasConfigured={configuredProviders.has(TracingProvider.weave)}
      onConfig={handleOnConfig(TracingProvider.weave)}
      isChosen={chosenProvider === TracingProvider.weave}
      onChoose={handleOnChoose(TracingProvider.weave)}
      key="weave-provider-panel"
    />
  )

  const aliyunPanel = (
    <ProviderPanel
      type={TracingProvider.aliyun}
      readOnly={readOnly || failedProviders.has(TracingProvider.aliyun)}
      config={aliyunConfig}
      hasConfigured={configuredProviders.has(TracingProvider.aliyun)}
      onConfig={handleOnConfig(TracingProvider.aliyun)}
      isChosen={chosenProvider === TracingProvider.aliyun}
      onChoose={handleOnChoose(TracingProvider.aliyun)}
      key="aliyun-provider-panel"
    />
  )

  const mlflowPanel = (
    <ProviderPanel
      type={TracingProvider.mlflow}
      readOnly={readOnly || failedProviders.has(TracingProvider.mlflow)}
      config={mlflowConfig}
      hasConfigured={configuredProviders.has(TracingProvider.mlflow)}
      onConfig={handleOnConfig(TracingProvider.mlflow)}
      isChosen={chosenProvider === TracingProvider.mlflow}
      onChoose={handleOnChoose(TracingProvider.mlflow)}
      key="mlflow-provider-panel"
    />
  )

  const databricksPanel = (
    <ProviderPanel
      type={TracingProvider.databricks}
      readOnly={readOnly || failedProviders.has(TracingProvider.databricks)}
      config={databricksConfig}
      hasConfigured={configuredProviders.has(TracingProvider.databricks)}
      onConfig={handleOnConfig(TracingProvider.databricks)}
      isChosen={chosenProvider === TracingProvider.databricks}
      onChoose={handleOnChoose(TracingProvider.databricks)}
      key="databricks-provider-panel"
    />
  )

  const tencentPanel = (
    <ProviderPanel
      type={TracingProvider.tencent}
      readOnly={readOnly || failedProviders.has(TracingProvider.tencent)}
      config={tencentConfig}
      hasConfigured={configuredProviders.has(TracingProvider.tencent)}
      onConfig={handleOnConfig(TracingProvider.tencent)}
      isChosen={chosenProvider === TracingProvider.tencent}
      onChoose={handleOnChoose(TracingProvider.tencent)}
      key="tencent-provider-panel"
    />
  )
  const configuredProviderPanel = () => {
    const configuredPanels: JSX.Element[] = []

    if (configuredProviders.has(TracingProvider.langfuse)) configuredPanels.push(langfusePanel)

    if (configuredProviders.has(TracingProvider.langSmith)) configuredPanels.push(langSmithPanel)

    if (configuredProviders.has(TracingProvider.opik)) configuredPanels.push(opikPanel)

    if (configuredProviders.has(TracingProvider.weave)) configuredPanels.push(weavePanel)

    if (configuredProviders.has(TracingProvider.arize)) configuredPanels.push(arizePanel)

    if (configuredProviders.has(TracingProvider.phoenix)) configuredPanels.push(phoenixPanel)

    if (configuredProviders.has(TracingProvider.aliyun)) configuredPanels.push(aliyunPanel)

    if (configuredProviders.has(TracingProvider.mlflow)) configuredPanels.push(mlflowPanel)

    if (configuredProviders.has(TracingProvider.databricks)) configuredPanels.push(databricksPanel)

    if (configuredProviders.has(TracingProvider.tencent)) configuredPanels.push(tencentPanel)

    return configuredPanels
  }

  const moreProviderPanel = () => {
    const notConfiguredPanels: JSX.Element[] = []

    if (!configuredProviders.has(TracingProvider.arize)) notConfiguredPanels.push(arizePanel)

    if (!configuredProviders.has(TracingProvider.phoenix)) notConfiguredPanels.push(phoenixPanel)

    if (!configuredProviders.has(TracingProvider.langfuse)) notConfiguredPanels.push(langfusePanel)

    if (!configuredProviders.has(TracingProvider.langSmith))
      notConfiguredPanels.push(langSmithPanel)

    if (!configuredProviders.has(TracingProvider.opik)) notConfiguredPanels.push(opikPanel)

    if (!configuredProviders.has(TracingProvider.weave)) notConfiguredPanels.push(weavePanel)

    if (!configuredProviders.has(TracingProvider.aliyun)) notConfiguredPanels.push(aliyunPanel)

    if (!configuredProviders.has(TracingProvider.mlflow)) notConfiguredPanels.push(mlflowPanel)

    if (!configuredProviders.has(TracingProvider.databricks))
      notConfiguredPanels.push(databricksPanel)

    if (!configuredProviders.has(TracingProvider.tencent)) notConfiguredPanels.push(tencentPanel)

    return notConfiguredPanels
  }

  const configuredProviderConfig = () => {
    if (currentProvider === TracingProvider.mlflow) return mlflowConfig
    if (currentProvider === TracingProvider.databricks) return databricksConfig
    if (currentProvider === TracingProvider.arize) return arizeConfig
    if (currentProvider === TracingProvider.phoenix) return phoenixConfig
    if (currentProvider === TracingProvider.langSmith) return langSmithConfig
    if (currentProvider === TracingProvider.langfuse) return langFuseConfig
    if (currentProvider === TracingProvider.opik) return opikConfig
    if (currentProvider === TracingProvider.aliyun) return aliyunConfig
    if (currentProvider === TracingProvider.tencent) return tencentConfig
    return weaveConfig
  }

  return (
    <div className="w-105 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <TracingIcon size="md" className="mr-2" />
          <div className="title-2xl-semi-bold text-text-primary">
            {t(($) => $[`${I18N_PREFIX}.tracing`], { ns: 'app' })}
          </div>
        </div>
        <div className="flex items-center">
          <StatusDot status={enabled ? 'success' : 'disabled'} />
          <div
            className={cn(
              'ml-1 system-xs-semibold-uppercase text-text-tertiary',
              enabled && 'text-util-colors-green-green-600',
            )}
          >
            {t(($) => $[`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`], { ns: 'app' })}
          </div>
          {!readOnly && (
            <>
              {providerAllNotConfigured ? (
                <Tooltip>
                  <TooltipTrigger render={switchContent} />
                  <TooltipContent>
                    {t(($) => $[`${I18N_PREFIX}.disabledTip`], { ns: 'app' })}
                  </TooltipContent>
                </Tooltip>
              ) : (
                switchContent
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-2 system-xs-regular text-text-tertiary">
        {t(($) => $[`${I18N_PREFIX}.tracingDescription`], { ns: 'app' })}
      </div>
      {hasConfigLoadErrors && (
        <div className="mt-3">
          <ConfigLoadError loading={isFetching} onRetry={() => void refetch()} />
        </div>
      )}
      <Divider className="my-3" />
      <div className="relative">
        {providerAllConfigured || providerAllNotConfigured ? (
          <>
            <div className="system-xs-medium-uppercase text-text-tertiary">
              {t(
                ($) =>
                  $[
                    `${I18N_PREFIX}.configProviderTitle.${providerAllConfigured ? 'configured' : 'notConfigured'}`
                  ],
                { ns: 'app' },
              )}
            </div>
            <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
              {langfusePanel}
              {langSmithPanel}
              {opikPanel}
              {mlflowPanel}
              {databricksPanel}
              {weavePanel}
              {arizePanel}
              {phoenixPanel}
              {aliyunPanel}
              {tencentPanel}
            </div>
          </>
        ) : (
          <>
            <div className="system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $[`${I18N_PREFIX}.configProviderTitle.configured`], { ns: 'app' })}
            </div>
            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
              {configuredProviderPanel()}
            </div>
            <div className="mt-3 system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $[`${I18N_PREFIX}.configProviderTitle.moreProvider`], { ns: 'app' })}
            </div>
            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">{moreProviderPanel()}</div>
          </>
        )}
      </div>
      {isShowConfigModal && (
        <Suspense fallback={null}>
          <ProviderConfigModal
            appId={appId}
            type={currentProvider!}
            payload={configuredProviderConfig()}
            onCancel={hideConfigModal}
            onSaved={handleConfigUpdated}
            onChosen={onChooseProvider}
            onRemoved={handleConfigRemoved}
          />
        </Suspense>
      )}
    </div>
  )
}
export default React.memo(ConfigPopup)
