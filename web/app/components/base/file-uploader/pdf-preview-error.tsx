'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

type PdfPreviewErrorProps = {
  onRetry: () => void
  /**
   * The surface this error is rendered on top of.
   *
   * `overlay` sits directly on a dark, translucent backdrop — the attachment
   * dialog's `bg-black/80`, which composites to roughly `#333333`. Regular
   * `text-text-secondary` is only about 1.2:1 against that, so this variant uses
   * the `on-surface` text tokens instead. Those resolve to the same near-white
   * value in both themes, so the variant does not degrade in dark mode.
   *
   * `panel` sits on an ordinary panel background, where `text-text-secondary`
   * is already legible.
   */
  variant?: 'panel' | 'overlay'
}

/**
 * Rendered by `PdfLoader` when the document fails to load. Without an
 * `errorMessage` prop the library renders `null`, which leaves the preview
 * surface blank, so both PDF surfaces pass this in.
 *
 * `PdfLoader` clones the element with the load error injected, hence the
 * optional `error` prop.
 */
const PdfPreviewError = ({
  onRetry,
  variant = 'panel',
}: PdfPreviewErrorProps & { error?: Error }) => {
  const { t } = useTranslation(['common'])

  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <span
        className={`system-sm-medium ${variant === 'overlay' ? 'text-text-secondary-on-surface' : 'text-text-secondary'}`}
      >
        {t(($) => $['operation.pdfLoadFailed'])}
      </span>
      <Button variant="secondary" onClick={onRetry}>
        {t(($) => $['operation.retry'])}
      </Button>
    </div>
  )
}

export default PdfPreviewError
