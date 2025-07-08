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
  key: string
  size: number
}

export type OnlineDriveData = {
  bucket: string
  files: OnlineDriveFile[]
  is_truncated: boolean
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
