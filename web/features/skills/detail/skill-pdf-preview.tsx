'use client'

import { noop } from 'es-toolkit/function'
import {
  PdfHighlighter,
  PdfLoader,
} from '@/app/components/base/file-uploader/pdf-highlighter-adapter'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

export function SkillPdfPreview({ fileName, url }: { fileName: string; url: string }) {
  return (
    <div className="relative h-full overflow-hidden bg-background-default">
      <span className="sr-only">{fileName}</span>
      <PdfLoader
        workerSrc="/pdf.worker.min.mjs"
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
