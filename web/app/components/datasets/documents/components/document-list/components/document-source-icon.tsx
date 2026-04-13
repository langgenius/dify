import type { FC } from 'react'
import type { LegacyDataSourceInfo, LocalFileInfo, OnlineDocumentInfo, OnlineDriveInfo, SimpleDocumentDetail } from '@/models/datasets'
import { RiGlobalLine } from '@remixicon/react'
import * as React from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import NotionIcon from '@/app/components/base/notion-icon'
import { extensionToFileType } from '@/app/components/datasets/hit-testing/utils/extension-to-file-type'
import { DataSourceType } from '@/models/datasets'
import { DatasourceType } from '@/models/pipeline'

type DocumentSourceIconProps = {
  doc: SimpleDocumentDetail
  fileType?: string
}

const isLocalFile = (dataSourceType: DataSourceType | DatasourceType) => {
  return dataSourceType === DatasourceType.localFile || dataSourceType === DataSourceType.FILE
}

const isOnlineDocument = (dataSourceType: DataSourceType | DatasourceType) => {
  return dataSourceType === DatasourceType.onlineDocument || dataSourceType === DataSourceType.NOTION
}

const isWebsiteCrawl = (dataSourceType: DataSourceType | DatasourceType) => {
  return dataSourceType === DatasourceType.websiteCrawl || dataSourceType === DataSourceType.WEB
}

const isOnlineDrive = (dataSourceType: DataSourceType | DatasourceType) => {
  return dataSourceType === DatasourceType.onlineDrive
}

const isCreateFromRAGPipeline = (createdFrom: string) => {
  return createdFrom === 'rag-pipeline'
}

const getFileExtension = (fileName: string): string => {
  if (!fileName)
    return ''
  const parts = fileName.split('.')
  if (parts.length <= 1 || (parts[0] === '' && parts.length === 2))
    return ''
  return parts[parts.length - 1].toLowerCase()
}

const DocumentSourceIcon: FC<DocumentSourceIconProps> = React.memo(({
  doc,
  fileType,
}) => {
  if (isOnlineDocument(doc.data_source_type)) {
    return (
      <NotionIcon
        className="mr-1.5"
        type="page"
        src={
          isCreateFromRAGPipeline(doc.created_from)
            ? (doc.data_source_info as OnlineDocumentInfo).page.page_icon
            : (doc.data_source_info as LegacyDataSourceInfo).notion_page_icon
        }
      />
    )
  }

  if (isLocalFile(doc.data_source_type)) {
    return (
      <FileTypeIcon
        type={
          extensionToFileType(
            isCreateFromRAGPipeline(doc.created_from)
              ? (doc?.data_source_info as LocalFileInfo)?.extension
              : ((doc?.data_source_info as LegacyDataSourceInfo)?.upload_file?.extension ?? fileType),
          )
        }
        className="mr-1.5"
      />
    )
  }

  if (isOnlineDrive(doc.data_source_type)) {
    return (
      <FileTypeIcon
        type={
          extensionToFileType(
            getFileExtension((doc?.data_source_info as unknown as OnlineDriveInfo)?.name),
          )
        }
        className="mr-1.5"
      />
    )
  }

  if (isWebsiteCrawl(doc.data_source_type)) {
    return <RiGlobalLine className="mr-1.5 size-4" />
  }

  return null
})

DocumentSourceIcon.displayName = 'DocumentSourceIcon'

export default DocumentSourceIcon
