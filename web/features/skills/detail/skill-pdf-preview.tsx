'use client'

import { noop } from 'es-toolkit/function'
import {
  PdfHighlighter,
  PdfLoader,
} from '@/app/components/base/file-uploader/pdf-highlighter-adapter'
import Loading from '@/app/components/base/loading'

export function SkillPdfPreview({ fileName, url }: { fileName: string; url: string }) {
  return (
    <div aria-label={fileName} className="relative h-full overflow-hidden bg-background-default">
      <PdfLoader
        workerSrc="/pdf.worker.min.mjs"
        url={url}
        beforeLoad={
          <div className="flex h-full items-center justify-center">
            <Loading type="app" />
          </div>
        }
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
