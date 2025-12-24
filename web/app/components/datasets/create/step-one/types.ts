import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { DataSourceProvider, NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, DataSourceType, FileItem } from '@/models/datasets'

// Base props shared by all data source components
export type DataSourceBaseProps = {
  isShowVectorSpaceFull: boolean
  onStepChange: () => void
}

// File source specific props
export type FileSourceProps = DataSourceBaseProps & {
  files: FileItem[]
  updateFileList: (files: FileItem[]) => void
  updateFile: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  onPreview: (file: File) => void
  shouldShowDataSourceTypeList: boolean
  supportBatchUpload: boolean
  enableBilling: boolean
  isSandboxPlan: boolean
}

// Notion source specific props
export type NotionSourceProps = DataSourceBaseProps & {
  datasetId?: string
  notionPages: NotionPage[]
  notionCredentialId: string
  updateNotionPages: (value: NotionPage[]) => void
  updateNotionCredentialId: (credentialId: string) => void
  onPreview: (page: NotionPage) => void
  onSetting: () => void
  isNotionAuthed: boolean
  notionCredentialList: DataSourceAuth['credentials_list']
}

// Web source specific props
export type WebSourceProps = DataSourceBaseProps & {
  shouldShowDataSourceTypeList: boolean
  websitePages: CrawlResultItem[]
  updateWebsitePages: (value: CrawlResultItem[]) => void
  onPreview: (website: CrawlResultItem) => void
  onWebsiteCrawlProviderChange: (provider: DataSourceProvider) => void
  onWebsiteCrawlJobIdChange: (jobId: string) => void
  crawlOptions: CrawlOptions
  onCrawlOptionsChange: (payload: CrawlOptions) => void
  authedDataSourceList: DataSourceAuth[]
}

// Data source selector props
export type DataSourceSelectorProps = {
  dataSourceType: DataSourceType
  dataSourceTypeDisable: boolean
  changeType: (type: DataSourceType) => void
  onHideFilePreview: () => void
  onHideNotionPreview: () => void
  onHideWebsitePreview: () => void
}

// Preview state type
export type PreviewState = {
  currentFile: File | undefined
  currentNotionPage: NotionPage | undefined
  currentWebsite: CrawlResultItem | undefined
}

// Preview actions type
export type PreviewActions = {
  updateCurrentFile: (file: File) => void
  hideFilePreview: () => void
  updateCurrentPage: (page: NotionPage) => void
  hideNotionPagePreview: () => void
  updateWebsite: (website: CrawlResultItem) => void
  hideWebsitePreview: () => void
}
