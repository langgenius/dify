import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

type ZoomControlsProps = {
  disabled: boolean
  zoomBy: (factor: number) => void
  reset: () => void
}

export function ZoomControls({ disabled, zoomBy, reset }: ZoomControlsProps) {
  const { t } = useTranslation(['common'])
  return (
    <>
      <IconButton
        size="lg"
        aria-label={t(($) => $['operation.zoomIn'])}
        disabled={disabled}
        onClick={() => zoomBy(1.25)}
      >
        <span aria-hidden className="i-ri-add-line size-4" />
      </IconButton>
      <IconButton
        size="lg"
        aria-label={t(($) => $['operation.zoomOut'])}
        disabled={disabled}
        onClick={() => zoomBy(0.8)}
      >
        <span aria-hidden className="i-ri-subtract-line size-4" />
      </IconButton>
      <IconButton
        size="lg"
        aria-label={t(($) => $['operation.reset'])}
        disabled={disabled}
        onClick={reset}
      >
        <span aria-hidden className="i-ri-restart-line size-4" />
      </IconButton>
    </>
  )
}
