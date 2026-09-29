import { IS_DEV } from '@/config'
import Script from '@/next/script'

export function ReactScanLoader() {
  if (!IS_DEV) return null

  return (
    <Script
      src="//unpkg.com/react-scan/dist/auto.global.js"
      crossOrigin="anonymous"
      // React Scan recommends beforeInteractive to catch initial renders, but it
      // can mismatch with Dify's inline attribution bootstrap during dev hydration.
      strategy="afterInteractive"
    />
  )
}
