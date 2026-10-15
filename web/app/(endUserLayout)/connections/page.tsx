import { getRouteMetadata } from '@/app/route-metadata'
import { getLocaleOnServer, getTranslation } from '@/i18n/server'

export function generateMetadata() {
  return getRouteMetadata('app', ($) => $['endUser.connections'])
}

export default async function Page() {
  const { t } = await getTranslation(await getLocaleOnServer(), 'app')

  return (
    <div className="flex min-h-full flex-col gap-8 p-6 md:p-8">
      <h1 className="title-2xl-semi-bold text-text-primary">
        {t(($) => $['endUser.connections'], { ns: 'app' })}
      </h1>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
        <span aria-hidden className="mb-2 i-ri-plug-line size-10 text-text-quaternary" />
        <h2 className="system-md-medium text-text-secondary">
          {t(($) => $['endUser.connectionsEmpty'], { ns: 'app' })}
        </h2>
        <p className="max-w-90 body-sm-regular text-text-tertiary">
          {t(($) => $['endUser.connectionsEmptyDescription'], { ns: 'app' })}
        </p>
      </div>
    </div>
  )
}
