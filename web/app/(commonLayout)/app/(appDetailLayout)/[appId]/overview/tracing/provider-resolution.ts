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
import type { TracingStatus } from '@/models/app'
import { TracingProvider } from './type'

export type ConfiguredTracingProviders = {
  langFuseConfig: LangFuseConfig | null
  langSmithConfig: LangSmithConfig | null
  opikConfig: OpikConfig | null
  weaveConfig: WeaveConfig | null
  arizeConfig: ArizeConfig | null
  phoenixConfig: PhoenixConfig | null
  aliyunConfig: AliyunConfig | null
  mlflowConfig: MLflowConfig | null
  databricksConfig: DatabricksConfig | null
  tencentConfig: TencentConfig | null
}

const configuredProviderOrder: Array<[TracingProvider, keyof ConfiguredTracingProviders]> = [
  [TracingProvider.langfuse, 'langFuseConfig'],
  [TracingProvider.langSmith, 'langSmithConfig'],
  [TracingProvider.opik, 'opikConfig'],
  [TracingProvider.weave, 'weaveConfig'],
  [TracingProvider.arize, 'arizeConfig'],
  [TracingProvider.phoenix, 'phoenixConfig'],
  [TracingProvider.aliyun, 'aliyunConfig'],
  [TracingProvider.mlflow, 'mlflowConfig'],
  [TracingProvider.databricks, 'databricksConfig'],
  [TracingProvider.tencent, 'tencentConfig'],
]

export const getConfiguredTracingProvider = (configs: ConfiguredTracingProviders): TracingProvider | null => {
  for (const [provider, configKey] of configuredProviderOrder) {
    if (configs[configKey])
      return provider
  }
  return null
}

export const resolveTracingProvider = (tracingStatus: TracingStatus | null, configs: ConfiguredTracingProviders): TracingProvider | null => {
  return tracingStatus?.tracing_provider ?? getConfiguredTracingProvider(configs)
}
