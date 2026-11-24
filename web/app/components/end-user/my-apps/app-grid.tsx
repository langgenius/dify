import type { EndUserApp } from './model'
import { useTranslation } from 'react-i18next'
import { AppCardSkeleton } from '@/app/components/apps/app-card-skeleton'
import EndUserAppCard from './app-card'

type Props = {
  apps: readonly EndUserApp[]
  authSession: number
  loading?: boolean
}

export default function AppGrid({ apps, authSession, loading }: Props) {
  const { t } = useTranslation(['common'])
  return (
    <>
      {loading && (
        <p role="status" className="sr-only">
          {t(($) => $.loading, { ns: 'common' })}
        </p>
      )}
      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        aria-busy={loading || undefined}
      >
        {loading ? (
          <AppCardSkeleton count={4} />
        ) : (
          apps.map((app) => <EndUserAppCard key={app.id} app={app} authSession={authSession} />)
        )}
      </ul>
    </>
  )
}
