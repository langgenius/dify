import type { EndUserApp } from './model'
import EndUserAppCard from './app-card'

type Props = {
  apps: readonly EndUserApp[]
  authSession: number
}

export default function AppGrid({ apps, authSession }: Props) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {apps.map((app) => (
        <EndUserAppCard key={app.id} app={app} authSession={authSession} />
      ))}
    </ul>
  )
}
