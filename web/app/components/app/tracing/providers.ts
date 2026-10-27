import type { TraceConfigPayload } from '@dify/contracts/api/console/apps/types.gen'

export const tracingProviders = {
  langfuse: {
    docUrl: 'https://docs.langfuse.com',
    icon: 'i-custom-public-tracing-langfuse-icon w-18.5',
    panelIcon: 'i-custom-public-tracing-langfuse-icon-big w-27.75',
  },
  langsmith: {
    docUrl: 'https://docs.smith.langchain.com/',
    icon: 'i-custom-public-tracing-langsmith-icon w-21',
    panelIcon: 'i-custom-public-tracing-langsmith-icon-big w-31',
  },
  opik: {
    docUrl: 'https://www.comet.com/docs/opik/integrations/dify',
    icon: 'i-custom-public-tracing-opik-icon w-[47.133904px]',
    panelIcon: 'i-custom-public-tracing-opik-icon-big w-[70.700851px]',
  },
  mlflow: {
    docUrl: 'https://mlflow.org/docs/latest/genai/',
    icon: 'i-custom-public-tracing-mlflow-icon w-11',
    panelIcon: 'i-custom-public-tracing-mlflow-icon-big w-16.25',
  },
  databricks: {
    docUrl: 'https://docs.databricks.com/aws/en/mlflow3/genai/tracing/',
    icon: 'i-custom-public-tracing-databricks-icon w-25',
    panelIcon: 'i-custom-public-tracing-databricks-icon-big w-37.5',
  },
  weave: {
    docUrl: 'https://weave-docs.wandb.ai/',
    icon: 'i-custom-public-tracing-weave-icon w-30',
    panelIcon: 'i-custom-public-tracing-weave-icon-big w-31',
  },
  arize: {
    docUrl: 'https://docs.arize.com/arize',
    icon: 'i-custom-public-tracing-arize-icon w-18.5',
    panelIcon: 'i-custom-public-tracing-arize-icon-big w-27.75',
  },
  phoenix: {
    docUrl: 'https://docs.arize.com/phoenix',
    icon: 'i-custom-public-tracing-phoenix-icon w-18.5',
    panelIcon: 'i-custom-public-tracing-phoenix-icon-big w-27.75',
  },
  aliyun: {
    docUrl: 'https://help.aliyun.com/zh/arms/tracing-analysis/untitled-document-1750672984680',
    icon: 'i-custom-public-tracing-aliyun-icon w-16.25',
    panelIcon: 'i-custom-public-tracing-aliyun-icon-big w-24',
  },
  tencent: {
    docUrl: 'https://cloud.tencent.com/document/product/248/116531',
    icon: 'i-custom-public-tracing-tencent-icon w-20',
    panelIcon: 'i-custom-public-tracing-tencent-icon-big w-30',
  },
} as const satisfies Partial<
  Record<
    TraceConfigPayload['tracing_provider'],
    { docUrl: string; icon: string; panelIcon: string }
  >
>

export type ConfigurableTracingProvider = keyof typeof tracingProviders

export function hasProviderForm(
  provider: TraceConfigPayload['tracing_provider'] | null | undefined,
): provider is ConfigurableTracingProvider {
  return provider != null && Object.hasOwn(tracingProviders, provider)
}

export const configurableProviders = Object.keys(tracingProviders).filter(hasProviderForm)
