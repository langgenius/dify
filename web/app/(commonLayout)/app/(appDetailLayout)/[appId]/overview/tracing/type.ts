export enum TracingProvider {
  arize = 'arize',
  phoenix = 'phoenix',
  langSmith = 'langsmith',
  langfuse = 'langfuse',
  opik = 'opik',
  weave = 'weave',
  aliyun = 'aliyun',
}

export type ArizeConfig = {
  api_key: string
  space_id: string
  project: string
  endpoint: string
}

export type PhoenixConfig = {
  api_key: string
  project: string
  endpoint: string
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

export type OpikConfig = {
  api_key: string
  project: string
  workspace: string
  url: string
}

export type WeaveConfig = {
  api_key: string
  entity: string
  project: string
  endpoint: string
  host: string
}

export type AliyunConfig = {
  app_name: string
  license_key: string
  endpoint: string
}
