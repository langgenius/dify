import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

type PdfPreviewErrorProps = {
  onRetry: () => void
  // 'overlay' renders inside the zoomed preview dialog on a raised surface,
  // 'panel' renders inline in the skill detail preview on the page background.
  variant?: 'overlay' | 'panel'
}

export function PdfPreviewError({ onRetry, variant = 'panel' }: PdfPreviewErrorProps) {
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
