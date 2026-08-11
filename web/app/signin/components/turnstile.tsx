import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | undefined>(undefined)
  const [hasError, setHasError] = useState(false)
  const [scriptGeneration, setScriptGeneration] = useState(0)

  const removeWidget = () => {
    const widgetId = widgetIdRef.current
    widgetIdRef.current = undefined

    const turnstile = getTurnstileApi()
    if (!widgetId || !turnstile) return
    turnstile.remove(widgetId)
  }

  useEffect(() => {
    return () => {
      const widgetId = widgetIdRef.current
      widgetIdRef.current = undefined

      const turnstile = getTurnstileApi()
      if (!widgetId || !turnstile) return
      turnstile.remove(widgetId)
    }
  }, [])

  const handleChallengeError = () => {
    onInvalidate()
    removeWidget()
    setHasError(true)
  }

  const renderWidget = () => {
    const turnstile = getTurnstileApi()
    if (!containerRef.current || !turnstile || widgetIdRef.current) return

    try {
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: 'signin_code',
        appearance: 'always',
        size: 'flexible',
        theme: 'auto',
        callback: onVerify,
        'error-callback': () => {
          handleChallengeError()
          return true
        },
        'expired-callback': onInvalidate,
        'timeout-callback': onInvalidate,
        'unsupported-callback': handleChallengeError,
      })
    } catch {
      handleChallengeError()
    }
  }

  const handleRetry = () => {
    const canReuseLoadedScript = Boolean(getTurnstileApi())

    removeWidget()
    setHasError(false)

    if (canReuseLoadedScript) renderWidget()
    else setScriptGeneration((current) => current + 1)
  }

  const scriptId = scriptGeneration
    ? `cloudflare-turnstile-${scriptGeneration}`
    : 'cloudflare-turnstile'
  const scriptSrc = scriptGeneration
    ? `${TURNSTILE_SCRIPT_SRC}#retry-${scriptGeneration}`
    : TURNSTILE_SCRIPT_SRC

  return (
    <>
      {hasError && (
        <div
          role="alert"
          className="mt-3 flex min-h-16 w-full items-center gap-3 rounded-xl border border-state-destructive-border bg-state-destructive-hover-alt p-3"
        >
          <span className="i-ri-error-warning-fill size-4 shrink-0 text-text-destructive" />
          <span className="grow system-xs-regular text-text-destructive">
            {t(($) => $['turnstile.loadError'], { ns: 'login' })}
          </span>
          <Button type="button" size="small" variant="secondary" onClick={handleRetry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      <div ref={containerRef} className={`mt-3 min-h-16 w-full ${hasError ? 'hidden' : ''}`} />
      <Script
        key={scriptGeneration}
        id={scriptId}
        src={scriptSrc}
        strategy="afterInteractive"
        onReady={renderWidget}
        onError={handleChallengeError}
      />
    </>
  )
}
