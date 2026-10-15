import type { EndUserApp, RemoveAppRequest } from './model'
import EndUserAppCard from './app-card'

type Props = {
  apps: readonly EndUserApp[]
  getAppHref: (app: EndUserApp) => string
  onToggleStar: (id: string) => void
  onRemove: (request: RemoveAppRequest) => void
}

export default function AppGrid({ apps, getAppHref, onToggleStar, onRemove }: Props) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {apps.map((app) => (
        <EndUserAppCard
          key={app.id}
          app={app}
          href={getAppHref(app)}
          onToggleStar={() => onToggleStar(app.id)}
          onRemove={(deleteChats) => onRemove({ app, deleteChats })}
        />
      ))}
    </ul>
  )
}
