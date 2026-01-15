'use client'
import type { FC } from 'react'
import type { AliyunConfig, ArizeConfig, DatabricksConfig, LangFuseConfig, LangSmithConfig, MLflowConfig, OpikConfig, PhoenixConfig, TencentConfig, WeaveConfig } from './type'
import type { TracingStatus } from '@/models/app'
import {
  RiArrowDownDoubleLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { AliyunIcon, ArizeIcon, DatabricksIcon, LangfuseIcon, LangsmithIcon, MlflowIcon, OpikIcon, PhoenixIcon, TencentIcon, WeaveIcon } from '@/app/components/base/icons/src/public/tracing'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import Indicator from '@/app/components/header/indicator'
import { useAppContext } from '@/context/app-context'
import { fetchTracingConfig as doFetchTracingConfig, fetchTracingStatus, updateTracingStatus } from '@/service/apps'
import { cn } from '@/utils/classnames'
import ConfigButton from './config-button'
import TracingIcon from './tracing-icon'
import { TracingProvider } from './type'

const I18N_PREFIX = 'tracing'

const Panel: FC = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const matched = /\/app\/([^/]+)/.exec(pathname)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const { isCurrentWorkspaceEditor } = useAppContext()
  const readOnly = !isCurrentWorkspaceEditor

  const [isLoaded, {
    setTrue: setLoaded,
  }] = useBoolean(false)

  const [tracingStatus, setTracingStatus] = useState<TracingStatus | null>(null)
  const enabled = tracingStatus?.enabled || false
  const handleTracingStatusChange = async (tracingStatus: TracingStatus, noToast?: boolean) => {
    await updateTracingStatus({ appId, body: tracingStatus })
    setTracingStatus(tracingStatus)
    if (!noToast) {
      Toast.notify({
        type: 'success',
        message: t('api.success', { ns: 'common' }),
      })
    }
  }

  const handleTracingEnabledChange = (enabled: boolean) => {
    handleTracingStatusChange({
      tracing_provider: tracingStatus?.tracing_provider || null,
      enabled,
    })
  }
  const handleChooseProvider = (provider: TracingProvider) => {
    handleTracingStatusChange({
      tracing_provider: provider,
      enabled: true,
    })
  }
  const inUseTracingProvider: TracingProvider | null = tracingStatus?.tracing_provider || null

  const providerIconMap: Record<TracingProvider, React.FC<{ className?: string }>> = {
    [TracingProvider.arize]: ArizeIcon,
    [TracingProvider.phoenix]: PhoenixIcon,
    [TracingProvider.langSmith]: LangsmithIcon,
    [TracingProvider.langfuse]: LangfuseIcon,
    [TracingProvider.opik]: OpikIcon,
    [TracingProvider.weave]: WeaveIcon,
    [TracingProvider.aliyun]: AliyunIcon,
    [TracingProvider.mlflow]: MlflowIcon,
    [TracingProvider.databricks]: DatabricksIcon,
    [TracingProvider.tencent]: TencentIcon,
  }
  const InUseProviderIcon = inUseTracingProvider ? providerIconMap[inUseTracingProvider] : undefined

  const [arizeConfig, setArizeConfig] = useState<ArizeConfig | null>(null)
  const [phoenixConfig, setPhoenixConfig] = useState<PhoenixConfig | null>(null)
  const [langSmithConfig, setLangSmithConfig] = useState<LangSmithConfig | null>(null)
  const [langFuseConfig, setLangFuseConfig] = useState<LangFuseConfig | null>(null)
  const [opikConfig, setOpikConfig] = useState<OpikConfig | null>(null)
  const [weaveConfig, setWeaveConfig] = useState<WeaveConfig | null>(null)
  const [aliyunConfig, setAliyunConfig] = useState<AliyunConfig | null>(null)
  const [mlflowConfig, setMLflowConfig] = useState<MLflowConfig | null>(null)
  const [databricksConfig, setDatabricksConfig] = useState<DatabricksConfig | null>(null)
  const [tencentConfig, setTencentConfig] = useState<TencentConfig | null>(null)
  const hasConfiguredTracing = !!(langSmithConfig || langFuseConfig || opikConfig || weaveConfig || arizeConfig || phoenixConfig || aliyunConfig || mlflowConfig || databricksConfig || tencentConfig)

  const fetchTracingConfig = async () => {
    const getArizeConfig = async () => {
      const { tracing_config: arizeConfig, has_not_configured: arizeHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.arize })
      if (!arizeHasNotConfig)
        setArizeConfig(arizeConfig as ArizeConfig)
    }
    const getPhoenixConfig = async () => {
      const { tracing_config: phoenixConfig, has_not_configured: phoenixHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.phoenix })
      if (!phoenixHasNotConfig)
        setPhoenixConfig(phoenixConfig as PhoenixConfig)
    }
    const getLangSmithConfig = async () => {
      const { tracing_config: langSmithConfig, has_not_configured: langSmithHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.langSmith })
      if (!langSmithHasNotConfig)
        setLangSmithConfig(langSmithConfig as LangSmithConfig)
    }
    const getLangFuseConfig = async () => {
      const { tracing_config: langFuseConfig, has_not_configured: langFuseHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.langfuse })
      if (!langFuseHasNotConfig)
        setLangFuseConfig(langFuseConfig as LangFuseConfig)
    }
    const getOpikConfig = async () => {
      const { tracing_config: opikConfig, has_not_configured: OpikHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.opik })
      if (!OpikHasNotConfig)
        setOpikConfig(opikConfig as OpikConfig)
    }
    const getWeaveConfig = async () => {
      const { tracing_config: weaveConfig, has_not_configured: weaveHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.weave })
      if (!weaveHasNotConfig)
        setWeaveConfig(weaveConfig as WeaveConfig)
    }
    const getAliyunConfig = async () => {
      const { tracing_config: aliyunConfig, has_not_configured: aliyunHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.aliyun })
      if (!aliyunHasNotConfig)
        setAliyunConfig(aliyunConfig as AliyunConfig)
    }
    const getMLflowConfig = async () => {
      const { tracing_config: mlflowConfig, has_not_configured: mlflowHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.mlflow })
      if (!mlflowHasNotConfig)
        setMLflowConfig(mlflowConfig as MLflowConfig)
    }
    const getDatabricksConfig = async () => {
      const { tracing_config: databricksConfig, has_not_configured: databricksHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.databricks })
      if (!databricksHasNotConfig)
        setDatabricksConfig(databricksConfig as DatabricksConfig)
    }
    const getTencentConfig = async () => {
      const { tracing_config: tencentConfig, has_not_configured: tencentHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.tencent })
      if (!tencentHasNotConfig)
        setTencentConfig(tencentConfig as TencentConfig)
    }
    Promise.all([
      getArizeConfig(),
      getPhoenixConfig(),
      getLangSmithConfig(),
      getLangFuseConfig(),
      getOpikConfig(),
      getWeaveConfig(),
      getAliyunConfig(),
      getMLflowConfig(),
      getDatabricksConfig(),
      getTencentConfig(),
    ])
  }

  const handleTracingConfigUpdated = async (provider: TracingProvider) => {
    // call api to hide secret key value
    const { tracing_config } = await doFetchTracingConfig({ appId, provider })
    if (provider === TracingProvider.arize)
      setArizeConfig(tracing_config as ArizeConfig)
    else if (provider === TracingProvider.phoenix)
      setPhoenixConfig(tracing_config as PhoenixConfig)
    else if (provider === TracingProvider.langSmith)
      setLangSmithConfig(tracing_config as LangSmithConfig)
    else if (provider === TracingProvider.langfuse)
      setLangFuseConfig(tracing_config as LangFuseConfig)
    else if (provider === TracingProvider.opik)
      setOpikConfig(tracing_config as OpikConfig)
    else if (provider === TracingProvider.weave)
      setWeaveConfig(tracing_config as WeaveConfig)
    else if (provider === TracingProvider.aliyun)
      setAliyunConfig(tracing_config as AliyunConfig)
    else if (provider === TracingProvider.tencent)
      setTencentConfig(tracing_config as TencentConfig)
  }

  const handleTracingConfigRemoved = (provider: TracingProvider) => {
    if (provider === TracingProvider.arize)
      setArizeConfig(null)
    else if (provider === TracingProvider.phoenix)
      setPhoenixConfig(null)
    else if (provider === TracingProvider.langSmith)
      setLangSmithConfig(null)
    else if (provider === TracingProvider.langfuse)
      setLangFuseConfig(null)
    else if (provider === TracingProvider.opik)
      setOpikConfig(null)
    else if (provider === TracingProvider.weave)
      setWeaveConfig(null)
    else if (provider === TracingProvider.aliyun)
      setAliyunConfig(null)
    else if (provider === TracingProvider.mlflow)
      setMLflowConfig(null)
    else if (provider === TracingProvider.databricks)
      setDatabricksConfig(null)
    else if (provider === TracingProvider.tencent)
      setTencentConfig(null)
    if (provider === inUseTracingProvider) {
      handleTracingStatusChange({
        enabled: false,
        tracing_provider: null,
      }, true)
    }
  }

  useEffect(() => {
    (async () => {
      const tracingStatus = await fetchTracingStatus({ appId })
      setTracingStatus(tracingStatus)
      await fetchTracingConfig()
      setLoaded()
    })()
  }, [])

  if (!isLoaded) {
    return (
      <div className="mb-3 flex items-center justify-between">
        <div className="w-[200px]">
          <Loading />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center justify-between')}>
      {!inUseTracingProvider && (
        <ConfigButton
          appId={appId}
          readOnly={readOnly}
          hasConfigured={false}
          enabled={enabled}
          onStatusChange={handleTracingEnabledChange}
          chosenProvider={inUseTracingProvider}
          onChooseProvider={handleChooseProvider}
          arizeConfig={arizeConfig}
          phoenixConfig={phoenixConfig}
          langSmithConfig={langSmithConfig}
          langFuseConfig={langFuseConfig}
          opikConfig={opikConfig}
          weaveConfig={weaveConfig}
          aliyunConfig={aliyunConfig}
          mlflowConfig={mlflowConfig}
          databricksConfig={databricksConfig}
          tencentConfig={tencentConfig}
          onConfigUpdated={handleTracingConfigUpdated}
          onConfigRemoved={handleTracingConfigRemoved}
        >
          <div
            className={cn(
              'flex cursor-pointer select-none items-center rounded-xl border-l-[0.5px] border-t border-effects-highlight bg-background-default-dodge p-2 shadow-xs hover:border-effects-highlight-lightmode-off hover:bg-background-default-lighter',
            )}
          >
            <TracingIcon size="md" />
            <div className="system-sm-semibold mx-2 text-text-secondary">{t(`${I18N_PREFIX}.title`, { ns: 'app' })}</div>
            <div className="rounded-md p-1">
              <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
            </div>
            <Divider type="vertical" className="h-3.5" />
            <div className="rounded-md p-1">
              <RiArrowDownDoubleLine className="h-4 w-4 text-text-tertiary" />
            </div>
          </div>
        </ConfigButton>
      )}
      {hasConfiguredTracing && (
        <ConfigButton
          appId={appId}
          readOnly={readOnly}
          hasConfigured
          enabled={enabled}
          onStatusChange={handleTracingEnabledChange}
          chosenProvider={inUseTracingProvider}
          onChooseProvider={handleChooseProvider}
          arizeConfig={arizeConfig}
          phoenixConfig={phoenixConfig}
          langSmithConfig={langSmithConfig}
          langFuseConfig={langFuseConfig}
          opikConfig={opikConfig}
          weaveConfig={weaveConfig}
          aliyunConfig={aliyunConfig}
          mlflowConfig={mlflowConfig}
          databricksConfig={databricksConfig}
          tencentConfig={tencentConfig}
          onConfigUpdated={handleTracingConfigUpdated}
          onConfigRemoved={handleTracingConfigRemoved}
        >
          <div
            className={cn(
              'flex cursor-pointer select-none items-center rounded-xl border-l-[0.5px] border-t border-effects-highlight bg-background-default-dodge p-2 shadow-xs hover:border-effects-highlight-lightmode-off hover:bg-background-default-lighter',
            )}
          >
            <div className="ml-4 mr-1 flex items-center">
              <Indicator color={enabled ? 'green' : 'gray'} />
              <div className="system-xs-semibold-uppercase ml-1.5 text-text-tertiary">
                {t(`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`, { ns: 'app' })}
              </div>
            </div>
            {InUseProviderIcon && <InUseProviderIcon className="ml-1 h-4" />}
            <div className="ml-2 rounded-md p-1">
              <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
            </div>
            <Divider type="vertical" className="h-3.5" />
          </div>
        </ConfigButton>
      )}
    </div>
  )
}
export default React.memo(Panel)
