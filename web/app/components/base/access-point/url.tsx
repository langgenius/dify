'use client'

import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import ShareQRCode from '@/app/components/base/qrcode'
import { AccessPointEndpoint } from './card'

type AccessPointUrlProps = {
  enabled: boolean
  label: string
  unavailableLabel: string
  value: string
  copiedLabel?: string
  copyDisabled?: boolean
  copyLabel?: string
  loading?: boolean
  unavailable?: boolean
  showOpen?: boolean
  showQrCode?: boolean
  showRegenerate?: boolean
  openUrl?: string
  onCopyError?: () => void
  onRegenerate?: () => void
  openDisabledReason?: string
  openLabel?: string
  qrCodeDownloadLabel?: string
  qrCodeLabel?: string
  qrCodeScanLabel?: string
  regenerateLabel?: string
  regenerateDisabled?: boolean
  regenerating?: boolean
}

export function AccessPointUrl({
  copiedLabel,
  copyDisabled = false,
  copyLabel,
  enabled,
  label,
  loading = false,
  onCopyError,
  onRegenerate,
  openDisabledReason,
  openLabel,
  openUrl,
  qrCodeDownloadLabel,
  qrCodeLabel,
  qrCodeScanLabel,
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
  const { t } = useTranslation(['common', 'appOverview'])
  const copyActionLabel = copyLabel || t(($) => $['operation.copy'])
  const qrCodeActionLabel =
    qrCodeLabel || t(($) => $['overview.appInfo.qrcode.title'], { ns: 'appOverview' })
  const regenerateActionLabel = regenerateLabel || t(($) => $['operation.regenerate'])
  const detailsAvailable = !loading && !unavailable
  const disabledOpenButton = (
    <Button
      variant="secondary"
      size="small"
      className="h-6 gap-1 px-1.5"
      disabled
      focusableWhenDisabled={Boolean(openDisabledReason)}
    >
      <span aria-hidden className="i-ri-external-link-line size-3.5" />
      {openLabel}
    </Button>
  )
  const disabledOpenAction = openDisabledReason ? (
    <Tooltip>
      <TooltipTrigger render={disabledOpenButton} />
      <TooltipContent>{openDisabledReason}</TooltipContent>
    </Tooltip>
  ) : (
    disabledOpenButton
  )

  const disabledActions = (
    <div className="flex items-center gap-0.5">
      <IconButton aria-label={copyActionLabel} disabled>
        <span aria-hidden className="i-ri-file-copy-line size-4" />
      </IconButton>
      {showQrCode && (
        <IconButton aria-label={qrCodeActionLabel} disabled>
          <span aria-hidden className="i-ri-qr-code-line size-4" />
        </IconButton>
      )}
      {showRegenerate && (
        <IconButton aria-label={regenerateActionLabel} disabled>
          <span aria-hidden className="i-ri-loop-left-line size-4" />
        </IconButton>
      )}
      {showOpen && (
        <>
          <span className="mx-1 h-3.5 w-px bg-divider-subtle" />
          {disabledOpenAction}
        </>
      )}
    </div>
  )

  const availableActions = (
    <div className="flex items-center gap-0.5">
      {copyDisabled ? (
        <IconButton aria-label={copyActionLabel} disabled>
          <span aria-hidden className="i-ri-file-copy-line size-4" />
        </IconButton>
      ) : (
        <CopyFeedback
          content={value}
          copyLabel={copyLabel}
          copiedLabel={copiedLabel}
          onCopyError={onCopyError}
        />
      )}
      {showQrCode &&
        (copyDisabled ? (
          <IconButton aria-label={qrCodeActionLabel} disabled>
            <span aria-hidden className="i-ri-qr-code-line size-4" />
          </IconButton>
        ) : (
          <ShareQRCode
            content={value}
            triggerLabel={qrCodeLabel}
            scanLabel={qrCodeScanLabel}
            downloadLabel={qrCodeDownloadLabel}
          />
        ))}
      {showRegenerate && (
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                aria-label={regenerateActionLabel}
                disabled={regenerateDisabled || regenerating}
                focusableWhenDisabled
                onClick={onRegenerate}
              >
                <span
                  aria-hidden
                  className={`i-ri-loop-left-line size-4 ${regenerating ? 'animate-spin motion-reduce:animate-none' : ''}`}
                />
              </IconButton>
            }
          />
          <TooltipContent>{regenerateActionLabel}</TooltipContent>
        </Tooltip>
      )}
      {showOpen && (
        <>
          <span className="mx-1 h-3.5 w-px bg-divider-regular" />
          {enabled && openUrl ? (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'small' }),
                'h-6 gap-1 px-1.5',
              )}
            >
              <span aria-hidden className="i-ri-external-link-line size-3.5" />
              {openLabel}
            </a>
          ) : (
            disabledOpenAction
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
