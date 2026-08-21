'use client'

import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import ShareQRCode from '@/app/components/base/qrcode'
import { AccessPointEndpoint } from './access-point-card'

type AccessPointUrlProps = {
  enabled: boolean
  label: string
  unavailableLabel: string
  value: string
  copyDisabled?: boolean
  loading?: boolean
  unavailable?: boolean
  showOpen?: boolean
  showQrCode?: boolean
  showRegenerate?: boolean
  openUrl?: string
  onRegenerate?: () => void
  openLabel?: string
  regenerateLabel?: string
  regenerateDisabled?: boolean
  regenerating?: boolean
}

export function AccessPointUrl({
  enabled,
  label,
  loading = false,
  copyDisabled = false,
  onRegenerate,
  openLabel,
  openUrl,
  regenerateDisabled = false,
  regenerateLabel,
  regenerating = false,
  showOpen = false,
  showQrCode = false,
  showRegenerate = false,
  unavailable = false,
  unavailableLabel,
  value,
}: AccessPointUrlProps) {
  const { t } = useTranslation()
  const detailsAvailable = !loading && !unavailable

  const disabledActions = (
    <div className="flex items-center gap-0.5">
      <div className="flex cursor-not-allowed items-center justify-center p-0.5">
        <span aria-hidden className="i-ri-file-copy-line size-4 text-text-disabled" />
      </div>
      {showQrCode && (
        <div className="flex cursor-not-allowed items-center justify-center p-0.5">
          <span aria-hidden className="i-ri-qr-code-line size-4 text-text-disabled" />
        </div>
      )}
      {showRegenerate && (
        <div className="flex cursor-not-allowed items-center justify-center p-0.5">
          <span aria-hidden className="i-ri-loop-left-line size-4 text-text-disabled" />
        </div>
      )}
      {showOpen && (
        <>
          <span className="mx-1 h-3.5 w-px bg-divider-subtle" />
          <div className="flex h-6 cursor-not-allowed items-center gap-1 rounded-md border-[0.5px] border-components-button-secondary-border-disabled px-1.5 system-sm-medium text-components-button-secondary-text-disabled backdrop-blur-xs">
            <span aria-hidden className="i-ri-external-link-line size-3.5" />
            {openLabel}
          </div>
        </>
      )}
    </div>
  )

  const availableActions = (
    <div className="flex items-center gap-0.5">
      {copyDisabled ? (
        <div className="flex cursor-not-allowed items-center justify-center p-0.5">
          <span aria-hidden className="i-ri-file-copy-line size-4 text-text-disabled" />
        </div>
      ) : (
        <CopyFeedback content={value} className="size-6" />
      )}
      {showQrCode &&
        (copyDisabled ? (
          <div className="flex cursor-not-allowed items-center justify-center p-0.5">
            <span aria-hidden className="i-ri-qr-code-line size-4 text-text-disabled" />
          </div>
        ) : (
          <ShareQRCode content={value} />
        ))}
      {showRegenerate && (
        <IconButton
          aria-label={regenerateLabel || t(($) => $['operation.regenerate'], { ns: 'common' })}
          disabled={regenerateDisabled || regenerating}
          onClick={onRegenerate}
        >
          <span
            aria-hidden
            className={`i-ri-loop-left-line size-4 ${regenerating ? 'animate-spin' : ''}`}
          />
        </IconButton>
      )}
      {showOpen && (
        <>
          <span className="mx-1 h-3.5 w-px bg-divider-regular" />
          {enabled && openUrl ? (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({
                variant: 'secondary',
                size: 'small',
                className: 'h-6 gap-1 px-1.5',
              })}
            >
              <span aria-hidden className="i-ri-external-link-line size-3.5" />
              {openLabel}
            </a>
          ) : (
            <Button variant="secondary" size="small" className="h-6 gap-1 px-1.5" disabled>
              <span aria-hidden className="i-ri-external-link-line size-3.5" />
              {openLabel}
            </Button>
          )}
        </>
      )}
    </div>
  )

  return (
    <AccessPointEndpoint
      label={label}
      value={value}
      unavailableLabel={unavailableLabel}
      unavailable={unavailable}
      dimmed={!enabled}
      loading={loading}
      actions={detailsAvailable ? availableActions : disabledActions}
    />
  )
}
