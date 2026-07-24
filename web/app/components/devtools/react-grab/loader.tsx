import Script from 'next/script'
import { IS_DEV } from '@/config'

export function ReactGrabLoader() {
  if (!IS_DEV)
    return null

  return (
    <>
      <Script
        src="//unpkg.com/react-grab/dist/index.global.js"
        crossOrigin="anonymous"
        strategy="beforeInteractive"
      />
    </>
  )
}
