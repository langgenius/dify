'use client'

import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import {
  PdfHighlighter,
  PdfLoader,
} from '@/app/components/base/file-uploader/pdf-highlighter-adapter'
import PdfPreviewError from '@/app/components/base/file-uploader/pdf-preview-error'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { basePath } from '@/utils/var'

export function SkillPdfPreview({ fileName, url }: { fileName: string; url: string }) {
  // PdfLoader only reloads when `url` changes, so retrying means remounting it.
  const [loadAttempt, setLoadAttempt] = useState(0)

  return (
    <div className="relative h-full overflow-hidden bg-background-default">
      <span className="sr-only">{fileName}</span>
      <PdfLoader
        key={loadAttempt}
        errorMessage={<PdfPreviewError onRetry={() => setLoadAttempt((attempt) => attempt + 1)} />}
        workerSrc={`${basePath}/pdf.worker.min.mjs`}
        url={url}
        beforeLoad={<LoadingPlaceholder className="h-full" />}
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
    </div>
  )
}
