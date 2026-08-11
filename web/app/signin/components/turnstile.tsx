import { useEffect, useRef } from 'react'
import Script from '@/next/script'

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileRenderOptions = {
  sitekey: string
  action: string
  appearance: 'always'
  size: 'flexible'
  theme: 'auto'
  callback: (token: string) => void
  'error-callback': (errorCode: string) => boolean
  'expired-callback': () => void
  'timeout-callback': () => void
  'unsupported-callback': () => void
}

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  remove: (widgetId: string) => void
}

const getTurnstileApi = () => (window as Window & { turnstile?: TurnstileApi }).turnstile

type TurnstileProps = {
  siteKey: string
  onVerify: (token: string) => void
  onInvalidate: () => void
}

export default function Turnstile({ siteKey, onVerify, onInvalidate }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    return () => {
      const turnstile = getTurnstileApi()
      if (!widgetIdRef.current || !turnstile) return

      turnstile.remove(widgetIdRef.current)
      widgetIdRef.current = undefined
    }
  }, [])

  const renderWidget = () => {
    const turnstile = getTurnstileApi()
    if (!containerRef.current || !turnstile || widgetIdRef.current) return

    widgetIdRef.current = turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: 'signin_code',
      appearance: 'always',
      size: 'flexible',
      theme: 'auto',
      callback: onVerify,
      'error-callback': () => {
        onInvalidate()
        return true
      },
      'expired-callback': onInvalidate,
      'timeout-callback': onInvalidate,
      'unsupported-callback': onInvalidate,
    })
  }

  return (
    <>
      <div ref={containerRef} className="mt-3 min-h-16 w-full" />
      <Script
        id="cloudflare-turnstile"
        src={TURNSTILE_SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={renderWidget}
        onError={onInvalidate}
      />
    </>
  )
}
