import Script from '@/next/script'

const GOOGLE_ANALYTICS_ID = 'G-DM9497FN4V'
const GOOGLE_TAG_SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`

type AnalyticsScriptProps = {
  nonce?: string
}

export function GoogleConsentDefaults({ nonce }: AnalyticsScriptProps) {
  return (
    <script id="google-consent-defaults" nonce={nonce}>
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
    </script>
  )
}

export function GoogleAnalyticsTagScripts({ nonce }: AnalyticsScriptProps) {
  return (
    <>
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        src={GOOGLE_TAG_SCRIPT_SRC}
        nonce={nonce}
      />
      <Script id="google-analytics-init" strategy="afterInteractive" nonce={nonce}>
        {`
          window.gtag('js', new Date());
          window.gtag('config', '${GOOGLE_ANALYTICS_ID}');
        `}
      </Script>
    </>
  )
}
