export const TracingProvider = {
  arize: 'arize',
  phoenix: 'phoenix',
  langSmith: 'langsmith',
  langfuse: 'langfuse',
  opik: 'opik',
  weave: 'weave',
  aliyun: 'aliyun',
  mlflow: 'mlflow',
  databricks: 'databricks',
  tencent: 'tencent',
} as const

export type TracingProvider = (typeof TracingProvider)[keyof typeof TracingProvider]
