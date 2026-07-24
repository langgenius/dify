'use client'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile, DocumentItem, FileIndexingEstimateResponse, FileItem } from '@/models/datasets'
import type { DatasourceType, OnlineDriveFile } from '@/models/pipeline'
import { memo } from 'react'
import ChunkPreview from '../preview/chunk-preview'
import FilePreview from '../preview/file-preview'
import OnlineDocumentPreview from '../preview/online-document-preview'
import WebsitePreview from '../preview/web-preview'

type StepOnePreviewProps = {
  datasource: Datasource | undefined
  currentLocalFile: CustomFile | undefined
  currentDocument: (NotionPage & { workspace_id: string }) | undefined
  currentWebsite: CrawlResultItem | undefined
  hidePreviewLocalFile: () => void
  hidePreviewOnlineDocument: () => void
  hideWebsitePreview: () => void
}

export const StepOnePreview = memo(({
  datasource,
  currentLocalFile,
  currentDocument,
  currentWebsite,
  hidePreviewLocalFile,
  hidePreviewOnlineDocument,
  hideWebsitePreview,
}: StepOnePreviewProps) => {
  return (
    <div className="h-full min-w-0 flex-1">
      <div className="flex h-full flex-col pl-2 pt-2">
        {currentLocalFile && (
          <FilePreview
            file={currentLocalFile}
            hidePreview={hidePreviewLocalFile}
          />
        )}
        {currentDocument && (
          <OnlineDocumentPreview
            datasourceNodeId={datasource!.nodeId}
            currentPage={currentDocument}
            hidePreview={hidePreviewOnlineDocument}
          />
        )}
        {currentWebsite && (
          <WebsitePreview
            currentWebsite={currentWebsite}
            hidePreview={hideWebsitePreview}
          />
        )}
      </div>
    </div>
  )
})
StepOnePreview.displayName = 'StepOnePreview'

type StepTwoPreviewProps = {
  datasourceType: string | undefined
  localFileList: FileItem[]
  onlineDocuments: (NotionPage & { workspace_id: string })[]
  websitePages: CrawlResultItem[]
  selectedOnlineDriveFileList: OnlineDriveFile[]
  isIdle: boolean
  isPendingPreview: boolean
  estimateData: FileIndexingEstimateResponse | undefined
  onPreview: () => void
  handlePreviewFileChange: (file: DocumentItem) => void
  handlePreviewOnlineDocumentChange: (page: NotionPage) => void
  handlePreviewWebsitePageChange: (website: CrawlResultItem) => void
  handlePreviewOnlineDriveFileChange: (file: OnlineDriveFile) => void
}

export const StepTwoPreview = memo(({
  datasourceType,
  localFileList,
  onlineDocuments,
  websitePages,
  selectedOnlineDriveFileList,
  isIdle,
  isPendingPreview,
  estimateData,
  onPreview,
  handlePreviewFileChange,
  handlePreviewOnlineDocumentChange,
  handlePreviewWebsitePageChange,
  handlePreviewOnlineDriveFileChange,
}: StepTwoPreviewProps) => {
  return (
    <div className="h-full min-w-0 flex-1">
      <div className="flex h-full flex-col pl-2 pt-2">
        <ChunkPreview
          dataSourceType={datasourceType as DatasourceType}
          localFiles={localFileList.map(file => file.file)}
          onlineDocuments={onlineDocuments}
          websitePages={websitePages}
          onlineDriveFiles={selectedOnlineDriveFileList}
          isIdle={isIdle}
          isPending={isPendingPreview}
          estimateData={estimateData}
          onPreview={onPreview}
          handlePreviewFileChange={handlePreviewFileChange}
          handlePreviewOnlineDocumentChange={handlePreviewOnlineDocumentChange}
          handlePreviewWebsitePageChange={handlePreviewWebsitePageChange}
          handlePreviewOnlineDriveFileChange={handlePreviewOnlineDriveFileChange}
        />
      </div>
    </div>
  )
})
StepTwoPreview.displayName = 'StepTwoPreview'
