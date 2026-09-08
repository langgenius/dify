import { Button } from '@langgenius/dify-ui/button'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  action: 'signin_code' | 'signin_code_verify'
  resetKey?: number
  siteKey: string
  onVerify: (token: string) => void
  onInvalidate: () => void
  onError?: () => void
}

export default function Turnstile({
  action,
  resetKey = 0,
  siteKey,
  onVerify,
  onInvalidate,
  onError,
}: TurnstileProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const onVerifyRef = useRef(onVerify)
  const onInvalidateRef = useRef(onInvalidate)
  const onErrorRef = useRef(onError)
  const [hasError, setHasError] = useState(false)
  const [isScriptReady, setIsScriptReady] = useState(false)
  const [scriptGeneration, setScriptGeneration] = useState(0)

  useEffect(() => {
    onVerifyRef.current = onVerify
    onInvalidateRef.current = onInvalidate
    onErrorRef.current = onError
  }, [onError, onInvalidate, onVerify])

  const invalidate = useCallback(() => {
    onInvalidateRef.current()
  }, [])

  const handleChallengeError = useCallback(() => {
    onErrorRef.current?.()
    setHasError(true)
  }, [])

  useEffect(() => {
    if (!isScriptReady || hasError) return

    const turnstile = getTurnstileApi()
    const container = containerRef.current
    if (!container || !turnstile) return

    let widgetId: string | undefined
    try {
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        action,
        appearance: 'always',
        size: 'flexible',
        theme: 'auto',
        callback: (token) => {
          onVerifyRef.current(token)
        },
        'error-callback': () => {
          handleChallengeError()
          return true
        },
        'expired-callback': invalidate,
        'timeout-callback': invalidate,
        'unsupported-callback': handleChallengeError,
      })
    } catch {
      queueMicrotask(handleChallengeError)
    }

    return () => {
      if (!widgetId) return
      turnstile.remove(widgetId)
    }
  }, [action, handleChallengeError, hasError, invalidate, isScriptReady, resetKey, siteKey])

  const handleScriptReady = () => {
    if (getTurnstileApi()) {
      setIsScriptReady(true)
      return
    }

    setIsScriptReady(false)
    handleChallengeError()
  }

  const handleScriptError = () => {
    setIsScriptReady(false)
    handleChallengeError()
  }

  const handleRetry = () => {
    const canReuseLoadedScript = Boolean(getTurnstileApi())

    setHasError(false)

    if (canReuseLoadedScript) {
      setIsScriptReady(true)
      return
    }

    setIsScriptReady(false)
    setScriptGeneration((current) => current + 1)
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
          className="mt-3 flex min-h-16.25 w-full items-center gap-3 rounded-xl border border-state-destructive-border bg-state-destructive-hover-alt p-3"
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
      <div ref={containerRef} className={`mt-3 h-16.25 w-full ${hasError ? 'hidden' : ''}`} />
      <Script
        key={scriptGeneration}
        id={scriptId}
        src={scriptSrc}
        strategy="afterInteractive"
        onReady={handleScriptReady}
        onError={handleScriptError}
      />
    </>
  )
}
