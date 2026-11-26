import type { RunContextCard as RunContextPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import { useTranslation } from 'react-i18next'
import { useBuilderText } from '../i18n/use-builder-text'
import { DifyBuilderCard } from './card-shell'

export const RunContextCard = ({
  payload,
  invalidated,
}: {
  payload: RunContextPayload
  invalidated: boolean
}) => {
  const { locale } = useBuilderText()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  return (
    <DifyBuilderCard
      category={t(($) => $['cardCategory.run'], { ns: 'difyBuilder' })}
      headline={payload.title || t(($) => $.failedRun, { ns: 'difyBuilder' })}
      invalidated={invalidated}
      meta={payload.error_code}
      status={{ state: 'failed' }}
    >
      <div className="flex flex-col gap-1">
        {!!payload.message && (
          <div className="system-xs-regular wrap-anywhere whitespace-pre-wrap text-text-secondary">
            {payload.message}
          </div>
        )}
        <div className="truncate font-mono text-[11px] text-text-tertiary">{payload.run_id}</div>
      </div>
    </DifyBuilderCard>
  )
}
