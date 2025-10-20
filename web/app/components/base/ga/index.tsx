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

// 从 CSP header 中提取 nonce
const extractNonceFromCSP = (cspHeader: string | null): string | undefined => {
  if (!cspHeader)
    return undefined
  const nonceMatch = cspHeader.match(/'nonce-([^']+)'/)
  return nonceMatch ? nonceMatch[1] : undefined
}

const GA: FC<IGAProps> = ({
  gaType,
}) => {
  if (IS_CE_EDITION)
    return null

  // 从 CSP header 中提取 nonce，而不是直接读取 x-nonce
  const cspHeader = process.env.NODE_ENV === 'production'
    ? (headers() as unknown as UnsafeUnwrappedHeaders).get('content-security-policy')
    : null
  const nonce = extractNonceFromCSP(cspHeader)

  // 服务端日志：验证 nonce 提取
  if (typeof window === 'undefined')
    console.log('[GA SSR] CSP header:', cspHeader ? 'exists' : 'MISSING', '| nonce:', nonce ? `extracted (${nonce.substring(0, 10)}...)` : 'NOT FOUND')

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
        src='https://cdn-cookieyes.com/client_data/2a645945fcae53f8e025a2b1/script.js'
        nonce={nonce}
      />
    </>
  )
}
export default React.memo(GA)
