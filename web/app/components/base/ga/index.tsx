import type { FC } from 'react'
import React from 'react'
import Script from 'next/script'
import { type UnsafeUnwrappedHeaders, headers } from 'next/headers'
import { IS_CE_EDITION } from '@/config'

export enum GaType {
  admin = 'admin',
  webapp = 'webapp',
}

const gaIdMaps = {
  [GaType.admin]: 'G-DM9497FN4V',
  [GaType.webapp]: 'G-2MFWXK7WYT',
}

export type IGAProps = {
  gaType: GaType
}

const GA: FC<IGAProps> = ({
  gaType,
}) => {
  if (IS_CE_EDITION)
    return null

  const nonce = process.env.NODE_ENV === 'production' ? (headers() as unknown as UnsafeUnwrappedHeaders).get('x-nonce') ?? '' : ''

  return (
    <>
      {/* Initialize dataLayer first */}
      <Script
        id="ga-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            window.gtag = function gtag(){window.dataLayer.push(arguments);};
            window.gtag('js', new Date());
            window.gtag('config', '${gaIdMaps[gaType]}');
          `,
        }}
        nonce={nonce ?? undefined}
      />
      {/* Load GA script */}
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaIdMaps[gaType]}`}
        nonce={nonce ?? undefined}
      />
      {/* Cookie banner */}
      <Script
        id="cookieyes"
        strategy="lazyOnload"
        src='https://cdn-cookieyes.com/client_data/2a645945fcae53f8e025a2b1/script.js'
        nonce={nonce ?? undefined}
      />
    </>
  )
}
export default React.memo(GA)
