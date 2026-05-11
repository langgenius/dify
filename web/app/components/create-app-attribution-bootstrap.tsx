import { memo } from 'react'
import { IS_PROD } from '@/config'
import { headers } from '@/next/headers'
import Script from '@/next/script'
import { buildCreateAppAttributionBootstrapScript } from '@/utils/create-app-tracking'

const CreateAppAttributionBootstrap = async () => {
  const nonce = IS_PROD ? (await headers()).get('x-nonce') ?? '' : ''
  /* v8 ignore next -- `nonce` is always a string (`''` or header value), so nullish fallback is unreachable in runtime. @preserve */
  const scriptNonce = nonce ?? undefined

  return (
    <Script
      id="create-app-attribution-bootstrap"
      strategy="beforeInteractive"
      nonce={scriptNonce}
    >
      {buildCreateAppAttributionBootstrapScript()}
    </Script>
  )
}

export default memo(CreateAppAttributionBootstrap)
