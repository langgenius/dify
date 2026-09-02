'use client'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useOAuthCallback } from '@/hooks/use-oauth'

const OAuthCallback = () => {
  const { t } = useTranslation()
  useDocumentTitle(t(($) => $.signBtn, { ns: 'login' }))
  const { hasOpener, finished, error, errorDescription } = useOAuthCallback()

  // When the page is opened as a popup by the console, the hook posts the
  // OAuth result to the opener and calls window.close(). The page only
  // needs to render a fallback message when the page was opened in a new
  // tab (no `window.opener`); see issue #39752.
  if (hasOpener || !finished) return <div />

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-default-subtle p-6">
      <div className="w-full max-w-md rounded-2xl border border-components-panel-border bg-components-panel-bg p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-text-primary">
          {error
            ? t(($) => $['callback.error'], { ns: 'oauth' })
            : t(($) => $['callback.success'], { ns: 'oauth' })}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {error
            ? errorDescription || t(($) => $['callback.errorHint'], { ns: 'oauth' })
            : t(($) => $['callback.successHint'], { ns: 'oauth' })}
        </p>
      </div>
    </div>
  )
}

export default OAuthCallback
