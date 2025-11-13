import { memo } from 'react'
import { type UnsafeUnwrappedHeaders, headers } from 'next/headers'
import Script from 'next/script'
import { IS_CE_EDITION, ZENDESK_WIDGET_KEY } from '@/config'

const Zendesk = () => {
  if (IS_CE_EDITION || !ZENDESK_WIDGET_KEY)
    return null

  const nonce = process.env.NODE_ENV === 'production' ? (headers() as unknown as UnsafeUnwrappedHeaders).get('x-nonce') ?? '' : ''

  return (
    <>
      <Script
        nonce={nonce ?? undefined}
        id="ze-snippet"
        src={`https://static.zdassets.com/ekr/snippet.js?key=${ZENDESK_WIDGET_KEY}`}
      />
      <Script nonce={nonce ?? undefined} id="ze-init">{`
        (function () {
          window.addEventListener('load', function () {
            if (window.zE)
              window.zE('messenger', 'hide')
          })
        })()
      `}</Script>
    </>
  )
}

export default memo(Zendesk)
