import { useTranslation } from 'react-i18next'
import { getHttpErrorStatus } from '@/service/http-error'

export function ExternalAgentRequestState({
  pending = false,
  forbidden = false,
  error,
}: {
  pending?: boolean
  forbidden?: boolean
  error?: unknown
}) {
  const { t } = useTranslation(['agentRoster'])
  const status = getHttpErrorStatus(error)
  const denied = forbidden || status === 403
  const missing = status === 404 || status === 410
  if (!pending && !denied && !missing) return null
  return (
    <div
      role={pending ? 'status' : 'alert'}
      className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-8 text-center system-sm-regular text-text-tertiary"
    >
      <p>
        {pending
          ? t(($) => $['external.api.loading'])
          : denied
            ? t(($) => $['external.api.noAccess'])
            : t(($) => $['external.api.notFound'])}
      </p>
    </div>
  )
}
