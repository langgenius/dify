import type { FC } from 'react'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { RiGlobalLine } from '@remixicon/react'
import * as React from 'react'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import NotionIcon from '@/app/components/base/notion-icon'
import { extensionToFileType } from '@/app/components/datasets/hit-testing/utils/extension-to-file-type'
import { DataSourceType } from '@/models/datasets'
import { DatasourceType } from '@/models/pipeline'
import {
  getLocalFileExtension,
  getNotionPageIcon,
  getOnlineDriveFileName,
  getUploadFileExtension,
} from '../../../document-source'

type DocumentSourceIconProps = {
  doc: SimpleDocumentDetail
  fileType?: string
}

const isLocalFile = (dataSourceType?: string | null) => {
  return dataSourceType === DatasourceType.localFile || dataSourceType === DataSourceType.FILE
}

const isOnlineDocument = (dataSourceType?: string | null) => {
  return (
    dataSourceType === DatasourceType.onlineDocument || dataSourceType === DataSourceType.NOTION
  )
}

const isWebsiteCrawl = (dataSourceType?: string | null) => {
  return dataSourceType === DatasourceType.websiteCrawl
}

const isOnlineDrive = (dataSourceType?: string | null) => {
  return dataSourceType === DatasourceType.onlineDrive
}

const isCreateFromRAGPipeline = (createdFrom?: string | null) => {
  return createdFrom === 'rag-pipeline'
}

const getFileExtension = (fileName: string): string => {
  if (!fileName) return ''
  const parts = fileName.split('.')
  if (parts.length <= 1 || (parts[0] === '' && parts.length === 2)) return ''
  return parts[parts.length - 1]!.toLowerCase()
}

const DocumentSourceIcon: FC<DocumentSourceIconProps> = React.memo(({ doc, fileType }) => {
  if (isOnlineDocument(doc.data_source_type)) {
    return (
      <NotionIcon
        className="mr-1.5"
        type="page"
        src={getNotionPageIcon(doc.data_source_info, isCreateFromRAGPipeline(doc.created_from))}
      />
    )
  }

  if (isLocalFile(doc.data_source_type)) {
    return (
      <FileTypeIcon
        type={extensionToFileType(
          isCreateFromRAGPipeline(doc.created_from)
            ? (getLocalFileExtension(doc.data_source_info) ?? '')
            : (getUploadFileExtension(doc.data_source_info) ?? fileType ?? ''),
        )}
        className="mr-1.5"
      />
    )
  }

  if (isOnlineDrive(doc.data_source_type)) {
    return (
      <FileTypeIcon
        type={extensionToFileType(
          getFileExtension(getOnlineDriveFileName(doc.data_source_info) ?? ''),
        )}
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
