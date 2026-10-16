import type { RequiredConnection } from '@/app/components/share/connections/required-connections'
import RequiredConnections from '@/app/components/share/connections/required-connections'
import { getRouteMetadata } from '@/app/route-metadata'

const demoConnections: readonly RequiredConnection[] = [
  { id: 'notion', name: 'Notion', iconClassName: 'i-custom-public-common-notion' },
  { id: 'gmail', name: 'Gmail', iconClassName: 'i-custom-public-common-gmail' },
  {
    id: 'youtube',
    name: 'YouTube',
    iconClassName: 'i-ri-youtube-fill text-util-colors-red-red-600',
  },
  { id: 'google-search', name: 'Google Search', iconClassName: 'i-custom-public-plugins-google' },
]

export function generateMetadata() {
  return getRouteMetadata('share', ($) => $['connections.required.title'])
}

export default function ConnectionsDemoPage() {
  return (
    <main className="min-h-dvh bg-background-body p-6 sm:p-8">
      <div className="w-150 max-w-full">
        <RequiredConnections connections={demoConnections} />
      </div>
    </main>
  )
}
