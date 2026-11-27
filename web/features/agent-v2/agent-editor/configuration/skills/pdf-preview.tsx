'use client'

import type { ReactElement } from 'react'
import { noop } from 'es-toolkit/function'
import { useEffect, useState } from 'react'
import {
  PdfHighlighter,
  PdfLoader,
} from '@/app/components/base/file-uploader/pdf-highlighter-adapter'
import { basePath } from '@/utils/var'

export function AgentFilePdfPreview({
  data,
  failure,
  loading,
  url,
}: {
  data?: Blob
  failure: ReactElement
  loading: ReactElement
  url?: string
}) {
  const [objectUrl, setObjectUrl] = useState<string>()

  useEffect(() => {
    if (!data) return

    const nextObjectUrl = URL.createObjectURL(data)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Browser object URLs are external resources created and revoked with this effect lifecycle.
    setObjectUrl(nextObjectUrl)
    return () => URL.revokeObjectURL(nextObjectUrl)
  }, [data])

  const pdfUrl = url ?? objectUrl

  return (
    <div className="relative flex min-h-40 flex-1 flex-col">
      {pdfUrl ? (
        <PdfLoader
          key={pdfUrl}
          workerSrc={`${basePath}/pdf.worker.min.mjs`}
          url={pdfUrl}
          beforeLoad={loading}
          errorMessage={failure}
        >
          {(pdfDocument) => (
            <PdfHighlighter
              pdfDocument={pdfDocument}
              pdfScaleValue="page-width"
              enableAreaSelection={() => false}
              scrollRef={noop}
              onScrollChange={noop}
              onSelectionFinished={() => null}
              highlightTransform={() => <div />}
              highlights={[]}
            />
          )}
        </PdfLoader>
      ) : (
        loading
      )}
    </div>
  )
}
