import Script from 'next/script'
import { IS_DEV } from '@/config'

export function ReactScanLoader() {
  if (!IS_DEV)
    return null

  return (
    <Script
      src="//unpkg.com/react-scan/dist/auto.global.js"
      crossOrigin="anonymous"
      strategy="beforeInteractive"
    />
  )
}
