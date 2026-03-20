import { IS_DEV } from '@/config'
import Script from '@/next/script'

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
