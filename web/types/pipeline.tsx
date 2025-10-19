import type { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth'

export type DataSourceNodeProcessingResponse = {
  event: 'datasource_processing'
  total: number
  completed: number
}

export type DataSourceNodeError = {
  event: 'datasource_error'
  message: string
  code?: string
}

export type OnlineDriveFile = {
  id: string
  name: string
  size: number
  type: 'file' | 'folder'
}

export type OnlineDriveData = {
  bucket: string
  files: OnlineDriveFile[]
  is_truncated: boolean
  next_page_parameters: Record<string, any>
}

export type DataSourceNodeCompletedResponse = {
  event: 'datasource_completed'
  data: any
  time_consuming: number
}

export type DataSourceNodeErrorResponse = {
  event: 'datasource_error'
  error: string
}

export type DataSourceCredential = {
  avatar_url?: string
  credential: Record<string, any>
  id: string
  is_default: boolean
  name: string
  type: CredentialTypeEnum
}
