import type { ConfiguredTracingProviders } from '../provider-resolution'
import { getConfiguredTracingProvider, resolveTracingProvider } from '../provider-resolution'
import { TracingProvider } from '../type'

const baseConfigs: ConfiguredTracingProviders = {
  langFuseConfig: null,
  langSmithConfig: null,
  opikConfig: null,
  weaveConfig: null,
  arizeConfig: null,
  phoenixConfig: null,
  aliyunConfig: null,
  mlflowConfig: null,
  databricksConfig: null,
  tencentConfig: null,
}

describe('tracing provider resolution', () => {
  it('returns null when no tracing provider config exists', () => {
    expect(getConfiguredTracingProvider(baseConfigs)).toBeNull()
  })

  it('falls back to configured provider when tracing status provider is null', () => {
    const configs: ConfiguredTracingProviders = {
      ...baseConfigs,
      langFuseConfig: {
        host: 'https://cloud.langfuse.com',
      } as ConfiguredTracingProviders['langFuseConfig'],
    }

    expect(resolveTracingProvider({ enabled: false, tracing_provider: null }, configs)).toBe(
      TracingProvider.langfuse,
    )
  })

  it('keeps the tracing status provider when present', () => {
    const configs: ConfiguredTracingProviders = {
      ...baseConfigs,
      langFuseConfig: {
        host: 'https://cloud.langfuse.com',
      } as ConfiguredTracingProviders['langFuseConfig'],
      langSmithConfig: {
        endpoint: 'https://api.smith.langchain.com',
      } as ConfiguredTracingProviders['langSmithConfig'],
    }

    expect(
      resolveTracingProvider(
        { enabled: false, tracing_provider: TracingProvider.langSmith },
        configs,
      ),
    ).toBe(TracingProvider.langSmith)
  })

  it('uses the configured provider priority order when multiple are set', () => {
    const configs: ConfiguredTracingProviders = {
      ...baseConfigs,
      opikConfig: { project: 'opik-project' } as ConfiguredTracingProviders['opikConfig'],
      langSmithConfig: {
        project: 'langsmith-project',
      } as ConfiguredTracingProviders['langSmithConfig'],
    }

    expect(getConfiguredTracingProvider(configs)).toBe(TracingProvider.langSmith)
  })
})
