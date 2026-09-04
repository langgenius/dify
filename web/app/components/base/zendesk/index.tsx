import { memo } from 'react'
import { IS_PROD, ZENDESK_WIDGET_KEY } from '@/config'
import { getOptionalSystemFeatures } from '@/features/system-features/server'
import { headers } from '@/next/headers'
import { ZendeskScript } from './script'

const Zendesk = async () => {
  if (!ZENDESK_WIDGET_KEY) return null

  const systemFeatures = await getOptionalSystemFeatures()
  if (!systemFeatures || systemFeatures.deployment_edition !== 'CLOUD') return null

  const nonce = IS_PROD ? ((await headers()).get('x-nonce') ?? '') : ''
  /* v8 ignore next -- `nonce` is always a string (`''` or header value), so nullish fallback is unreachable in runtime. @preserve */
  const scriptNonce = nonce ?? undefined

  return <ZendeskScript nonce={scriptNonce} widgetKey={ZENDESK_WIDGET_KEY} />
}

export default memo(Zendesk)
