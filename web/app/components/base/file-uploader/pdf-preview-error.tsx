'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

type PdfPreviewErrorProps = {
  onRetry: () => void
}

/**
 * Rendered by `PdfLoader` when the document fails to load. Without an
 * `errorMessage` prop the library renders `null`, which leaves the preview
 * surface blank, so both PDF surfaces pass this in.
 *
 * `PdfLoader` clones the element with the load error injected, hence the
 * optional `error` prop.
 */
const PdfPreviewError = ({ onRetry }: PdfPreviewErrorProps & { error?: Error }) => {
  const { t } = useTranslation(['common'])

  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <span className="system-sm-medium text-text-secondary">
        {t(($) => $['operation.pdfLoadFailed'])}
      </span>
      <Button variant="secondary" onClick={onRetry}>
        {t(($) => $['operation.retry'])}
      </Button>
    </div>
  )
}

export default PdfPreviewError
