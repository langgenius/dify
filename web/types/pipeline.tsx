export type DataSourceNodeProcessingResponse = {
  event: 'datasource_processing'
  total: number
  completed: number
}

type OnlineDriveFile = {
  id: string
  name: string
  size: number
  type: 'file' | 'folder'
}

export type OnlineDriveData = {
  bucket: string
  files: OnlineDriveFile[]
  is_truncated: boolean
  next_page_parameters: Record<string, unknown>
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
