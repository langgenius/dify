'use client'

import type { FilePreviewState } from './types'
import * as React from 'react'
import Loading from '@/app/components/base/loading'
import dynamic from '@/next/dynamic'
import MediaFilePreview from '../../../viewer/media-file-preview'
import UnsupportedFileDownload from '../../../viewer/unsupported-file-download'

const SQLiteFilePreview = dynamic(
  () => import('../../../viewer/sqlite-file-preview'),
  { ssr: false, loading: () => <Loading type="area" /> },
)

const PdfFilePreview = dynamic(
  () => import('../../../viewer/pdf-file-preview'),
  { ssr: false, loading: () => <Loading type="area" /> },
)

type FilePreviewRendererProps = {
  state: FilePreviewState
}

const FilePreviewRenderer = ({ state }: FilePreviewRendererProps) => {
  if (state.preview === 'media') {
    return (
      <MediaFilePreview
        type={state.mediaType}
        src={state.downloadUrl}
      />
    )
  }

  if (state.preview === 'sqlite') {
    return (
      <SQLiteFilePreview
        key={state.fileTabId}
        downloadUrl={state.downloadUrl}
      />
    )
  }

  if (state.preview === 'pdf')
    return <PdfFilePreview downloadUrl={state.downloadUrl} />

  return (
    <UnsupportedFileDownload
      name={state.fileName}
      size={state.fileSize}
      downloadUrl={state.downloadUrl}
    />
  )
}

export default React.memo(FilePreviewRenderer)
