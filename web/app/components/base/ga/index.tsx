import type { FC } from 'react'
import { headers } from 'next/headers'
import Script from 'next/script'
import * as React from 'react'
import { IS_CE_EDITION, IS_PROD } from '@/config'

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

const extractNonceFromCSP = (cspHeader: string | null): string | undefined => {
  if (!cspHeader)
    return undefined
  const nonceMatch = cspHeader.match(/'nonce-([^']+)'/)
  return nonceMatch ? nonceMatch[1] : undefined
}

const GA: FC<IGAProps> = async ({
  gaType,
}) => {
  if (IS_CE_EDITION)
    return null

  const cspHeader = IS_PROD
    ? (await headers()).get('content-security-policy')
    : null
  const nonce = extractNonceFromCSP(cspHeader)

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
        nonce={nonce}
      />
      {/* Load GA script */}
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaIdMaps[gaType]}`}
        nonce={nonce}
      />
      {/* Cookie banner */}
      <Script
        id="cookieyes"
        strategy="lazyOnload"
        src="https://cdn-cookieyes.com/client_data/2a645945fcae53f8e025a2b1/script.js"
        nonce={nonce}
      />
    </>
  )
}
export default React.memo(GA)
