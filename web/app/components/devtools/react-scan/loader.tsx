import { IS_DEV } from '@/config'
import Script from '@/next/script'

export function ReactScanLoader() {
  if (!IS_DEV)
    return null

  return (
    <Script
      src="//unpkg.com/react-scan/dist/auto.global.js"
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  )
}
