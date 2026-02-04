'use client'

import dynamic from 'next/dynamic'
import * as React from 'react'
import Loading from '@/app/components/base/loading'
import { useFetchTextContent } from '../hooks/use-fetch-text-content'
import { useFileTypeInfo } from '../hooks/use-file-type-info'
import { getFileLanguage } from '../utils/file-utils'
import MediaFilePreview from './media-file-preview'
import UnsupportedFileDownload from './unsupported-file-download'

const ReadOnlyCodePreview = dynamic(
  () => import('./read-only-code-preview'),
  { ssr: false, loading: () => <Loading type="area" /> },
)

const ReadOnlyMarkdownPreview = dynamic(
  () => import('./read-only-markdown-preview'),
  { ssr: false, loading: () => <Loading type="area" /> },
)

const SQLiteFilePreview = dynamic(
  () => import('./sqlite-file-preview'),
  { ssr: false, loading: () => <Loading type="area" /> },
)

type ReadOnlyFilePreviewProps = {
  downloadUrl: string
  fileName: string
  extension?: string | null
  fileSize?: number | null
}

const ReadOnlyFilePreview = ({
  downloadUrl,
  fileName,
  extension,
  fileSize,
}: ReadOnlyFilePreviewProps) => {
  const fileNode = React.useMemo(
    () => ({ name: fileName, extension }),
    [fileName, extension],
  )
  const { isMarkdown, isCodeOrText, isImage, isVideo, isSQLite, isPreviewable } = useFileTypeInfo(fileNode)
  const isTextFile = isPreviewable && (isMarkdown || isCodeOrText)
  const { data: textContent, isLoading: isTextLoading } = useFetchTextContent(
    isTextFile ? downloadUrl : undefined,
  )

  if (!isPreviewable) {
    return (
      <UnsupportedFileDownload
        name={fileName}
        size={fileSize ?? undefined}
        downloadUrl={downloadUrl}
      />
    )
  }

  if (isTextFile && isTextLoading)
    return <Loading type="area" />

  if (isMarkdown)
    return <ReadOnlyMarkdownPreview value={textContent ?? ''} />

  if (isCodeOrText) {
    return (
      <ReadOnlyCodePreview
        value={textContent ?? ''}
        language={getFileLanguage(fileName)}
      />
    )
  }

  if (isImage || isVideo)
    return <MediaFilePreview type={isImage ? 'image' : 'video'} src={downloadUrl} />

  if (isSQLite)
    return <SQLiteFilePreview downloadUrl={downloadUrl} />

  return (
    <UnsupportedFileDownload
      name={fileName}
      size={fileSize ?? undefined}
      downloadUrl={downloadUrl}
    />
  )
}

export default React.memo(ReadOnlyFilePreview)
