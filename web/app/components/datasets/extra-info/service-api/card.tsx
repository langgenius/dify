import { Button } from '@langgenius/dify-ui/button'
import { PopoverClose } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import Link from '@/next/link'

type CardProps = {
  apiBaseUrl: string
  canManageApiKey: boolean
  onOpenApiKeyModal: () => void
}

export function ServiceApiCard({ apiBaseUrl, canManageApiKey, onOpenApiKeyModal }: CardProps) {
  const { t } = useTranslation()

  const apiReferenceUrl = useDatasetApiAccessUrl()

  return (
    <div className="flex w-90 flex-col rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-1">
      <div className="flex flex-col gap-y-3 p-4">
        <div className="flex items-center gap-x-3">
          <div className="flex grow items-center gap-x-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-brand-blue-brand-500 shadow-md shadow-shadow-shadow-5">
              <span
                aria-hidden
                className="i-custom-vender-knowledge-api-aggregate size-4 text-text-primary-on-surface"
              />
            </div>
            <div className="grow truncate system-sm-semibold text-text-secondary">
              {t(($) => $['serviceApi.card.title'], { ns: 'dataset' })}
            </div>
          </div>
          <div className="flex items-center gap-x-1">
            <StatusDot className="shrink-0" status={apiBaseUrl ? 'success' : 'warning'} />
            <div className="system-xs-semibold-uppercase text-text-success">
              {t(($) => $['serviceApi.enabled'], { ns: 'dataset' })}
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="system-xs-regular leading-6 text-text-tertiary">
            {t(($) => $['serviceApi.card.endpoint'], { ns: 'dataset' })}
          </div>
          <div className="flex h-8 items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
            <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
              <div className="truncate system-xs-medium text-text-secondary">{apiBaseUrl}</div>
            </div>
            <CopyFeedback content={apiBaseUrl} />
          </div>
        </div>
      </div>
      <div className="flex gap-x-1 border-t-[0.5px] border-divider-subtle p-4">
        <PopoverClose
          render={
            <Button
              variant="ghost"
              size="small"
              className="text-text-tertiary"
              disabled={!canManageApiKey}
              onClick={onOpenApiKeyModal}
            >
              <span aria-hidden className="i-ri-key-2-line size-3.5 shrink-0" />
              <span className="system-xs-medium">
                {t(($) => $['serviceApi.card.apiKey'], { ns: 'dataset' })}
              </span>
            </Button>
          }
        />
        <Button
          variant="ghost"
          size="small"
          className="text-text-tertiary"
          render={<Link href={apiReferenceUrl} target="_blank" rel="noopener noreferrer" />}
        >
          <span aria-hidden className="i-ri-book-open-line size-3.5 shrink-0" />
          <span className="system-xs-medium">
            {t(($) => $['serviceApi.card.apiReference'], { ns: 'dataset' })}
          </span>
        </Button>
      </div>
    </div>
  )
}
