import { IS_PROD, ZENDESK_WIDGET_KEY } from '@/config'
import { getOptionalSystemFeatures } from '@/features/system-features/server'
import { headers } from '@/next/headers'
import { ZendeskScript } from './script'

export async function Zendesk() {
  if (!ZENDESK_WIDGET_KEY) return null

  const systemFeatures = await getOptionalSystemFeatures()
  if (!systemFeatures || systemFeatures.deployment_edition !== 'CLOUD') return null

  const nonce = IS_PROD ? ((await headers()).get('x-nonce') ?? '') : ''
  return <ZendeskScript nonce={nonce} widgetKey={ZENDESK_WIDGET_KEY} />
}
