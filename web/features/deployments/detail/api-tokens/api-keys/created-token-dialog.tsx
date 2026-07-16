'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useClipboard } from 'foxact/use-clipboard'
import { useTranslation } from 'react-i18next'
import { CopyPill } from '../../../shared/components/endpoint'

function buildCurlExample(apiUrl: string, token: string) {
  return `curl -X POST '${apiUrl}' \\
--header 'Authorization: Bearer ${token}' \\
--header 'Content-Type: application/json' \\
--data-raw '{
  "inputs": {},
  "response_mode": "streaming",
  "user": "abc-123"
}'`
}

function CurlExample({ apiUrl, token }: { apiUrl: string; token: string }) {
  const { t } = useTranslation('deployments')
  const curlExample = buildCurlExample(apiUrl, token)
  const { copied, copy } = useClipboard({
    onCopyError: () => {
      toast.error(t(($) => $['access.copyFailed']))
    },
  })

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-components-input-border-active bg-components-input-bg-normal">
      <div className="flex h-8 items-center justify-between gap-2 border-b border-divider-subtle pr-1.5 pl-3">
        <div className="min-w-0 truncate system-xs-semibold-uppercase text-text-secondary">
          {t(($) => $['access.api.curlExampleTitle'])}
        </div>
        <button
          type="button"
          onClick={() => copy(curlExample)}
          aria-label={t(($) => $['access.api.copyCurlExample'])}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <span className={cn(copied ? 'i-ri-check-line' : 'i-ri-file-copy-line', 'size-3.5')} />
        </button>
      </div>
      <pre className="max-h-40 overflow-auto px-3 py-3 font-mono system-xs-regular whitespace-pre text-text-secondary">
        <code>{curlExample}</code>
      </pre>
    </div>
  )
}

export function CreatedApiTokenDialog({
  token,
  apiUrl,
  onDismiss,
}: {
  token: string
  apiUrl?: string
  onDismiss: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <Dialog
      open={Boolean(token)}
      onOpenChange={(open) => !open && onDismiss()}
      disablePointerDismissal
    >
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] overflow-hidden p-0">
        <DialogCloseButton />
        <div className="border-b border-divider-subtle px-6 py-5 pr-14">
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {t(($) => $['access.api.newTokenTitle'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['access.api.newTokenDescription'])}
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          <CopyPill label={t(($) => $['access.api.newTokenLabel'])} value={token} />
          {apiUrl && <CurlExample apiUrl={apiUrl} token={token} />}
        </div>

        <div className="flex justify-end border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
          <Button variant="primary" onClick={onDismiss}>
            {t(($) => $['operation.confirm'], { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
