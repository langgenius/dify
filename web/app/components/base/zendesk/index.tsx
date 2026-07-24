import { memo } from 'react'
import { IS_PROD, ZENDESK_WIDGET_KEY } from '@/config'
import { getQueryClientServer } from '@/context/query-client-server'
import { serverSystemFeaturesQueryOptions } from '@/features/system-features/server'
import { headers } from '@/next/headers'
import Script from '@/next/script'

const Zendesk = async () => {
  if (!ZENDESK_WIDGET_KEY) return null

  const queryClient = getQueryClientServer()
  const systemFeaturesQuery = serverSystemFeaturesQueryOptions()
  await queryClient.prefetchQuery(systemFeaturesQuery)
  const systemFeatures = queryClient.getQueryData(systemFeaturesQuery.queryKey)
  if (!systemFeatures || systemFeatures.deployment_edition !== 'CLOUD') return null

  const nonce = IS_PROD ? ((await headers()).get('x-nonce') ?? '') : ''
  /* v8 ignore next -- `nonce` is always a string (`''` or header value), so nullish fallback is unreachable in runtime. @preserve */
  const scriptNonce = nonce ?? undefined

  return (
    <>
      <Script
        nonce={scriptNonce}
        id="ze-snippet"
        src={`https://static.zdassets.com/ekr/snippet.js?key=${ZENDESK_WIDGET_KEY}`}
        data-testid="ze-snippet"
      />
      <Script nonce={scriptNonce} id="ze-init" data-testid="ze-init">
        {`
        (function () {
          window.addEventListener('load', function () {
            if (window.zE)
              window.zE('messenger', 'hide')
          })
        })()
      `}
      </Script>
    </>
  )
}

export default memo(Zendesk)
