'use client'

import type { EmailRecipient } from './email-recipients'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@langgenius/dify-ui/field'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { hasEmailDelimiter, mergeEmailRecipients } from './email-recipients'

type EmailRecipientsFieldProps = {
  recipients: EmailRecipient[]
  onRecipientsChange: (recipients: EmailRecipient[]) => void
  onChange?: () => void
  error?: string
  remainingSeats: number | null
}

export function EmailRecipientsField({
  recipients,
  onRecipientsChange,
  onChange,
  error,
  remainingSeats,
}: EmailRecipientsFieldProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const hasInvalidRecipient = recipients.some(({ isValid }) => !isValid)
  const fieldError = hasInvalidRecipient
    ? t(($) => $['members.emailInvalid'], { ns: 'common' })
    : error
  const exceedsRemainingSeats = remainingSeats !== null && recipients.length > remainingSeats

  const updateRecipients = (nextRecipients: EmailRecipient[]) => {
    onRecipientsChange(nextRecipients)
    onChange?.()
  }

  const commitDraft = () => {
    if (!draft.trim()) return

    updateRecipients(mergeEmailRecipients(recipients, draft))
    setDraft('')
  }

  return (
    <Field name="emails" invalid={Boolean(fieldError)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <FieldLabel>{t(($) => $['members.emailRecipients'], { ns: 'common' })}</FieldLabel>
        <div
          aria-live="polite"
          aria-atomic="true"
          className="flex items-center gap-1 py-1 body-xs-regular text-text-tertiary tabular-nums"
        >
          {recipients.length > 0 && (
            <span>
              {t(($) => $['members.recipientCount'], {
                ns: 'common',
                count: recipients.length,
              })}
            </span>
          )}
          {recipients.length > 0 && remainingSeats !== null && <span aria-hidden="true">·</span>}
          {remainingSeats !== null && (
            <span>
              {t(($) => $['members.seatsRemaining'], {
                ns: 'common',
                count: remainingSeats,
              })}
            </span>
          )}
        </div>
      </div>
      <div
        className={cn(
          'flex max-h-28 flex-wrap content-start items-center gap-1 overflow-y-auto rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-1.5 transition-[background-color,border-color,box-shadow]',
          recipients.length > 0 ? 'min-h-16' : 'min-h-10',
          'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
          'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
          fieldError &&
            'border-components-input-border-destructive bg-components-input-bg-destructive',
        )}
      >
        {recipients.length > 0 && (
          <ul
            aria-label={t(($) => $['members.emailRecipients'], { ns: 'common' })}
            className="contents"
          >
            {recipients.map(({ value, isValid }) => {
              const errorId = `email-recipient-${encodeURIComponent(value)}-error`

              return (
                <li
                  key={value}
                  aria-describedby={!isValid ? errorId : undefined}
                  className={cn(
                    'flex h-6 max-w-full items-center gap-1 rounded-md bg-components-badge-bg-gray-soft px-2 system-xs-medium text-text-secondary',
                    !isValid && 'bg-components-badge-bg-red-soft text-text-destructive',
                  )}
                >
                  {!isValid && (
                    <span
                      aria-hidden="true"
                      className="i-ri-error-warning-fill size-3.5 shrink-0"
                    />
                  )}
                  <span className="truncate">{value}</span>
                  <button
                    type="button"
                    aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${value}`}
                    className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:outline-1 focus-visible:outline-text-accent"
                    onClick={() =>
                      updateRecipients(recipients.filter((recipient) => recipient.value !== value))
                    }
                  >
                    <span aria-hidden="true" className="i-ri-close-line size-3.5" />
                  </button>
                  {!isValid && (
                    <span id={errorId} className="sr-only">
                      {t(($) => $['members.emailInvalid'], { ns: 'common' })}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <FieldControl
          type="email"
          multiple
          autoComplete="off"
          spellCheck={false}
          inputMode="email"
          placeholder={t(($) => $['members.emailPlaceholder'], { ns: 'common' }) || ''}
          value={draft}
          className="h-6 w-auto min-w-40 grow rounded-none border-0 bg-transparent p-0 shadow-none hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent focus:shadow-none data-invalid:border-transparent data-invalid:bg-transparent"
          onChange={(event) => {
            setDraft(event.target.value)
            onChange?.()
          }}
          onInvalid={(event) => {
            event.preventDefault()
            commitDraft()
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' ||
              event.key === ',' ||
              event.key === ';' ||
              event.key === ' '
            ) {
              event.preventDefault()
              commitDraft()
              return
            }

            if (event.key === 'Backspace' && !draft && recipients.length > 0) {
              updateRecipients(recipients.slice(0, -1))
            }
          }}
          onPaste={(event) => {
            const pastedText = event.clipboardData.getData('text')
            if (!hasEmailDelimiter(pastedText)) return

            event.preventDefault()
            updateRecipients(mergeEmailRecipients(recipients, pastedText))
            setDraft('')
          }}
        />
      </div>
      {fieldError ? (
        <FieldError>{fieldError}</FieldError>
      ) : (
        <FieldDescription className={cn(exceedsRemainingSeats && 'text-text-warning')}>
          {exceedsRemainingSeats ? (
            <>
              <span
                aria-hidden="true"
                className="mr-1 i-ri-error-warning-line inline-block size-3"
              />
              {t(($) => $['members.recipientCountExceedsSeats'], { ns: 'common' })}
            </>
          ) : (
            t(($) => $['members.emailRecipientsTip'], { ns: 'common' })
          )}
        </FieldDescription>
      )}
    </Field>
  )
}
