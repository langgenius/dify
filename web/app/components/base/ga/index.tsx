import { IS_CLOUD_EDITION, IS_PROD } from '@/config'
import { headers } from '@/next/headers'
import Script from '@/next/script'

const GOOGLE_ANALYTICS_ID = 'G-DM9497FN4V'
const GOOGLE_TAG_SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`
const COOKIEYES_SCRIPT_SRC = 'https://cdn-cookieyes.com/client_data/2a645945fcae53f8e025a2b1/script.js'

export async function GoogleAnalyticsScripts() {
  if (!IS_CLOUD_EDITION || !IS_PROD)
    return null

  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <>
      <Script
        id="google-consent-defaults"
        strategy="afterInteractive"
        nonce={nonce}
      >
        {`
          window.dataLayer = window.dataLayer || [];
          window.gtag = window.gtag || function gtag(){window.dataLayer.push(arguments);};
          window.gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied',
          });
        `}
      </Script>
      <Script
        id="cookieyes"
        strategy="afterInteractive"
        src={COOKIEYES_SCRIPT_SRC}
        nonce={nonce}
      />
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        src={GOOGLE_TAG_SCRIPT_SRC}
        nonce={nonce}
      />
      <Script
        id="google-analytics-init"
        strategy="afterInteractive"
        nonce={nonce}
      >
        {`
          window.gtag('js', new Date());
          window.gtag('config', '${GOOGLE_ANALYTICS_ID}');
        `}
      </Script>
    </>
  )
}
