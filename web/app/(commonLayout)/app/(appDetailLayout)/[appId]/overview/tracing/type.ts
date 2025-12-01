export enum TracingProvider {
  arize = 'arize',
  phoenix = 'phoenix',
  langSmith = 'langsmith',
  langfuse = 'langfuse',
  opik = 'opik',
  weave = 'weave',
  aliyun = 'aliyun',
  mlflow = 'mlflow',
  databricks = 'databricks',
  tencent = 'tencent',
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

export type MLflowConfig = {
  tracking_uri: string
  experiment_id: string
  username: string
  password: string
}

export type DatabricksConfig = {
  experiment_id: string
  host: string
  client_id: string
  client_secret: string
  personal_access_token: string
}

export type TencentConfig = {
  token: string
  endpoint: string
  service_name: string
}
