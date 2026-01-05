import { headers } from 'next/headers'
import Script from 'next/script'
import { memo } from 'react'
import { IS_CE_EDITION, IS_PROD, ZENDESK_WIDGET_KEY } from '@/config'

const Zendesk = async () => {
  if (IS_CE_EDITION || !ZENDESK_WIDGET_KEY)
    return null

  const nonce = IS_PROD ? (await headers()).get('x-nonce') ?? '' : ''

  return (
    <>
      <Script
        nonce={nonce ?? undefined}
        id="ze-snippet"
        src={`https://static.zdassets.com/ekr/snippet.js?key=${ZENDESK_WIDGET_KEY}`}
      />
      <Script nonce={nonce ?? undefined} id="ze-init">
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
