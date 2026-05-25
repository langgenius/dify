import { IS_PROD } from '@/config'
import { headers } from '@/next/headers'
import Script from '@/next/script'
import { buildCreateAppAttributionBootstrapScript } from '@/utils/create-app-tracking'

export async function CreateAppAttributionBootstrap() {
  const nonce = IS_PROD ? (await headers()).get('x-nonce') ?? undefined : undefined
  return (
    <Script
      id="create-app-attribution-bootstrap"
      strategy="beforeInteractive"
      nonce={nonce}
    >
      {buildCreateAppAttributionBootstrapScript()}
    </Script>
  )
}
