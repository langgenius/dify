'use client'

import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useClipboard } from 'foxact/use-clipboard'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function CopyErrorAction({ text }: { text: string }) {
  const { t } = useTranslation()
  const { copy, copied, error, reset } = useClipboard({ timeout: 2000 })
  useEffect(() => reset, [reset])
  const [feedbackText, setFeedbackText] = useState<string | null>(null)
  const showCopied = feedbackText === text && copied
  const showError = feedbackText === text && error
  const label = showCopied
    ? t(($) => $['operation.copied'], { ns: 'common' })
    : showError
      ? t(($) => $['operation.copyErrorFailed'], { ns: 'common' })
      : t(($) => $['operation.copyErrorDetails'], { ns: 'common' })

  return (
    <>
      <IconButton
        aria-label={label}
        title={label}
        variant="secondary"
        className="absolute top-1 left-1/2 z-10 -translate-x-1/2 group-focus-visible/toast:opacity-100 group-has-focus-visible/toast:opacity-100 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/toast:opacity-100"
        onClick={() => {
          reset()
          setFeedbackText(null)
          void copy(text).then(() => setFeedbackText(text))
        }}
      >
        <span
          aria-hidden="true"
          className={
            showCopied
              ? 'i-ri-check-line size-4'
              : showError
                ? 'i-ri-error-warning-line size-4'
                : 'i-ri-file-copy-line size-4'
          }
        />
      </IconButton>
      <span className="sr-only" aria-live="polite">
        {showCopied || showError ? label : ''}
      </span>
    </>
  )
}
