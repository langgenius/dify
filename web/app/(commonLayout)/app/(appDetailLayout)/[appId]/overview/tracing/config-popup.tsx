'use client'
import type { TraceAppConfigResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { FC, JSX } from 'react'
import type { ProviderConfigError } from './provider-panel'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Separator } from '@langgenius/dify-ui/separator'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ProviderConfigModal from './provider-config-modal'
import ProviderPanel from './provider-panel'
import TracingIcon from './tracing-icon'
import { TracingProvider } from './type'

const I18N_PREFIX = 'tracing'

export type PopupProps = {
  appId: string
  configErrors?: Partial<Record<TracingProvider, ProviderConfigError>>
  onConfigRemoved: (provider: TracingProvider) => void
  readOnly: boolean
  enabled: boolean
  onStatusChange: (enabled: boolean) => void
  chosenProvider: TracingProvider | null
  onChooseProvider: (provider: TracingProvider) => void
  arizeConfig: TraceAppConfigResponse['tracing_config']
  phoenixConfig: TraceAppConfigResponse['tracing_config']
  langSmithConfig: TraceAppConfigResponse['tracing_config']
  langFuseConfig: TraceAppConfigResponse['tracing_config']
  opikConfig: TraceAppConfigResponse['tracing_config']
  weaveConfig: TraceAppConfigResponse['tracing_config']
  aliyunConfig: TraceAppConfigResponse['tracing_config']
  mlflowConfig: TraceAppConfigResponse['tracing_config']
  databricksConfig: TraceAppConfigResponse['tracing_config']
  tencentConfig: TraceAppConfigResponse['tracing_config']
}

const ConfigPopup: FC<PopupProps> = ({
  appId,
  configErrors,
  onConfigRemoved,
  readOnly,
  enabled,
  onStatusChange,
  chosenProvider,
  onChooseProvider,
  arizeConfig,
  phoenixConfig,
  langSmithConfig,
  langFuseConfig,
  opikConfig,
  weaveConfig,
  aliyunConfig,
  mlflowConfig,
  databricksConfig,
  tencentConfig,
}) => {
  const { t } = useTranslation(['app'])
  const dialogActionsRef = React.useRef<DialogActions>(null)
  const firstInputRef = React.useRef<HTMLInputElement>(null)
  const closeConfig = () => dialogActionsRef.current?.close()

  const handleOnChoose = useCallback(
    (provider: TracingProvider) => {
      return () => {
        onChooseProvider(provider)
      }
    },
    [onChooseProvider],
  )

  const providerConfigs = {
    [TracingProvider.arize]: arizeConfig,
    [TracingProvider.phoenix]: phoenixConfig,
    [TracingProvider.langSmith]: langSmithConfig,
    [TracingProvider.langfuse]: langFuseConfig,
    [TracingProvider.opik]: opikConfig,
    [TracingProvider.weave]: weaveConfig,
    [TracingProvider.aliyun]: aliyunConfig,
    [TracingProvider.mlflow]: mlflowConfig,
    [TracingProvider.databricks]: databricksConfig,
    [TracingProvider.tencent]: tencentConfig,
  } satisfies Record<TracingProvider, TraceAppConfigResponse['tracing_config']>
  const providerAllConfigured = Object.values(providerConfigs).every(Boolean)
  const providerAllNotConfigured = Object.values(providerConfigs).every((config) => !config)

  const cannotEnable = !enabled && (!chosenProvider || !providerConfigs[chosenProvider])

  const switchContent = (
    <Switch
      aria-label={t(($) => $[`${I18N_PREFIX}.tracing`], { ns: 'app' })}
      className="ml-3"
      checked={enabled}
      onCheckedChange={onStatusChange}
      disabled={cannotEnable}
    />
  )
  const arizePanel = (
    <ProviderPanel
      type={TracingProvider.arize}
      configError={configErrors?.[TracingProvider.arize]}
      readOnly={readOnly}
      config={arizeConfig}
      isChosen={chosenProvider === TracingProvider.arize}
      onChoose={handleOnChoose(TracingProvider.arize)}
      key="arize-provider-panel"
    />
  )

  const phoenixPanel = (
    <ProviderPanel
      type={TracingProvider.phoenix}
      configError={configErrors?.[TracingProvider.phoenix]}
      readOnly={readOnly}
      config={phoenixConfig}
      isChosen={chosenProvider === TracingProvider.phoenix}
      onChoose={handleOnChoose(TracingProvider.phoenix)}
      key="phoenix-provider-panel"
    />
  )

  const langSmithPanel = (
    <ProviderPanel
      type={TracingProvider.langSmith}
      configError={configErrors?.[TracingProvider.langSmith]}
      readOnly={readOnly}
      config={langSmithConfig}
      isChosen={chosenProvider === TracingProvider.langSmith}
      onChoose={handleOnChoose(TracingProvider.langSmith)}
      key="langSmith-provider-panel"
    />
  )

  const langfusePanel = (
    <ProviderPanel
      type={TracingProvider.langfuse}
      configError={configErrors?.[TracingProvider.langfuse]}
      readOnly={readOnly}
      config={langFuseConfig}
      isChosen={chosenProvider === TracingProvider.langfuse}
      onChoose={handleOnChoose(TracingProvider.langfuse)}
      key="langfuse-provider-panel"
    />
  )

  const opikPanel = (
    <ProviderPanel
      type={TracingProvider.opik}
      configError={configErrors?.[TracingProvider.opik]}
      readOnly={readOnly}
      config={opikConfig}
      isChosen={chosenProvider === TracingProvider.opik}
      onChoose={handleOnChoose(TracingProvider.opik)}
      key="opik-provider-panel"
    />
  )

  const weavePanel = (
    <ProviderPanel
      type={TracingProvider.weave}
      configError={configErrors?.[TracingProvider.weave]}
      readOnly={readOnly}
      config={weaveConfig}
      isChosen={chosenProvider === TracingProvider.weave}
      onChoose={handleOnChoose(TracingProvider.weave)}
      key="weave-provider-panel"
    />
  )

  const aliyunPanel = (
    <ProviderPanel
      type={TracingProvider.aliyun}
      configError={configErrors?.[TracingProvider.aliyun]}
      readOnly={readOnly}
      config={aliyunConfig}
      isChosen={chosenProvider === TracingProvider.aliyun}
      onChoose={handleOnChoose(TracingProvider.aliyun)}
      key="aliyun-provider-panel"
    />
  )

  const mlflowPanel = (
    <ProviderPanel
      type={TracingProvider.mlflow}
      configError={configErrors?.[TracingProvider.mlflow]}
      readOnly={readOnly}
      config={mlflowConfig}
      isChosen={chosenProvider === TracingProvider.mlflow}
      onChoose={handleOnChoose(TracingProvider.mlflow)}
      key="mlflow-provider-panel"
    />
  )

  const databricksPanel = (
    <ProviderPanel
      type={TracingProvider.databricks}
      configError={configErrors?.[TracingProvider.databricks]}
      readOnly={readOnly}
      config={databricksConfig}
      isChosen={chosenProvider === TracingProvider.databricks}
      onChoose={handleOnChoose(TracingProvider.databricks)}
      key="databricks-provider-panel"
    />
  )

  const tencentPanel = (
    <ProviderPanel
      type={TracingProvider.tencent}
      configError={configErrors?.[TracingProvider.tencent]}
      readOnly={readOnly}
      config={tencentConfig}
      isChosen={chosenProvider === TracingProvider.tencent}
      onChoose={handleOnChoose(TracingProvider.tencent)}
      key="tencent-provider-panel"
    />
  )
  const configuredProviderPanel = () => {
    const configuredPanels: JSX.Element[] = []

    if (langFuseConfig) configuredPanels.push(langfusePanel)

    if (langSmithConfig) configuredPanels.push(langSmithPanel)

    if (opikConfig) configuredPanels.push(opikPanel)

    if (weaveConfig) configuredPanels.push(weavePanel)

    if (arizeConfig) configuredPanels.push(arizePanel)

    if (phoenixConfig) configuredPanels.push(phoenixPanel)

    if (aliyunConfig) configuredPanels.push(aliyunPanel)

    if (mlflowConfig) configuredPanels.push(mlflowPanel)

    if (databricksConfig) configuredPanels.push(databricksPanel)

    if (tencentConfig) configuredPanels.push(tencentPanel)

    return configuredPanels
  }

  const moreProviderPanel = () => {
    const notConfiguredPanels: JSX.Element[] = []

    if (!arizeConfig) notConfiguredPanels.push(arizePanel)

    if (!phoenixConfig) notConfiguredPanels.push(phoenixPanel)

    if (!langFuseConfig) notConfiguredPanels.push(langfusePanel)

    if (!langSmithConfig) notConfiguredPanels.push(langSmithPanel)

    if (!opikConfig) notConfiguredPanels.push(opikPanel)

    if (!weaveConfig) notConfiguredPanels.push(weavePanel)

    if (!aliyunConfig) notConfiguredPanels.push(aliyunPanel)

    if (!mlflowConfig) notConfiguredPanels.push(mlflowPanel)

    if (!databricksConfig) notConfiguredPanels.push(databricksPanel)

    if (!tencentConfig) notConfiguredPanels.push(tencentPanel)

    return notConfiguredPanels
  }

  return (
    <Dialog<TracingProvider> actionsRef={dialogActionsRef} disablePointerDismissal>
      {({ payload: provider }) => (
        <>
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
                    {cannotEnable ? (
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
            <Separator className="my-3 h-[0.5px]" />
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
                  <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                    {moreProviderPanel()}
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogContent
            initialFocus={firstInputRef}
            className="w-160"
          >
            {provider && (
              <ProviderConfigModal
                appId={appId}
                type={provider}
                payload={providerConfigs[provider]}
                firstInputRef={firstInputRef}
                onSaved={closeConfig}
                onChosen={onChooseProvider}
                onRemoved={() => {
                  onConfigRemoved(provider)
                  closeConfig()
                }}
              />
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}
export default React.memo(ConfigPopup)
