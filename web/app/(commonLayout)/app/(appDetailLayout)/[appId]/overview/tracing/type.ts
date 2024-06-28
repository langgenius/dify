export enum TracingProvider {
  langSmith = 'langsmith',
  langfuse = 'langfuse',
}

export type LangSmithConfig = {
  api_key: string
  project: string
  endpoint: string
}

export type LangFuseConfig = {
  public_key: string
  secret_key: string
  host: string
}
