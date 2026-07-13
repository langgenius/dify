'use client'

import type { KeyboardEvent, RefObject } from 'react'
import type { EmailRecipient } from './email-recipients'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@langgenius/dify-ui/field'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createEmailRecipient, hasEmailDelimiter, mergeEmailRecipients } from './email-recipients'

type EmailRecipientsFieldProps = {
  recipients: EmailRecipient[]
  draft: string
  onRecipientsChange: (recipients: EmailRecipient[]) => void
  onDraftChange: (draft: string) => void
  onChange?: () => void
  error?: string
  disabled?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
}

function isRightToLeft(element: HTMLElement) {
  return getComputedStyle(element).direction === 'rtl' || document.documentElement.dir === 'rtl'
}

export function EmailRecipientsField({
  recipients,
  draft,
  onRecipientsChange,
  onDraftChange,
  onChange,
  error,
  disabled = false,
  inputRef: externalInputRef,
}: EmailRecipientsFieldProps) {
  const { t } = useTranslation()
  const internalInputRef = useRef<HTMLInputElement>(null)
  const chipButtonRef = useRef<Array<HTMLButtonElement | null>>([])
  const selectDraftOnRenderRef = useRef(false)
  const [draftTouched, setDraftTouched] = useState(false)
  const inputRef = externalInputRef ?? internalInputRef
  const hasInvalidRecipient = recipients.some(({ isValid }) => !isValid)
  const hasInvalidDraft = Boolean(
    draftTouched && draft.trim() && !createEmailRecipient(draft).isValid,
  )
  const fieldError =
    hasInvalidRecipient || hasInvalidDraft
      ? t(($) => $['members.emailInvalid'], { ns: 'common' })
      : error

  const updateRecipients = (nextRecipients: EmailRecipient[]) => {
    onRecipientsChange(nextRecipients)
    onChange?.()
  }

  const updateDraft = (nextDraft: string) => {
    onDraftChange(nextDraft)
    onChange?.()
  }

  const focusInput = (select = false) => {
    inputRef.current?.focus()
    if (select) {
      selectDraftOnRenderRef.current = true
      inputRef.current?.select()
    }
  }

  useEffect(() => {
    if (!selectDraftOnRenderRef.current) return

    inputRef.current?.select()
    selectDraftOnRenderRef.current = false
  }, [draft, inputRef])

  const removeRecipient = (index: number, focus: 'input' | 'neighbor') => {
    const nextRecipients = recipients.filter((_, recipientIndex) => recipientIndex !== index)
    const nextFocusIndex = index < nextRecipients.length ? index : index - 1
    const neighborIndex = index < recipients.length - 1 ? index + 1 : index - 1
    const neighbor = neighborIndex >= 0 ? chipButtonRef.current[neighborIndex] : null

    updateRecipients(nextRecipients)

    if (focus === 'neighbor' && nextFocusIndex >= 0) {
      neighbor?.focus()
      return
    }

    focusInput()
  }

  const editRecipient = (index: number) => {
    const recipient = recipients[index]
    if (!recipient) return

    updateRecipients(recipients.filter((_, recipientIndex) => recipientIndex !== index))
    updateDraft(recipient.value)
    setDraftTouched(false)
    focusInput(true)
  }

  const commitDraft = () => {
    if (!draft.trim()) return

    if (!createEmailRecipient(draft).isValid) {
      setDraftTouched(true)
      return
    }

    updateRecipients(mergeEmailRecipients(recipients, draft))
    updateDraft('')
    setDraftTouched(false)
  }

  const handleChipKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    isValid: boolean,
  ) => {
    if (disabled) return

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      removeRecipient(index, 'neighbor')
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (isValid) focusInput()
      else editRecipient(index)
      return
    }

    const rtl = isRightToLeft(event.currentTarget)
    const previousKey = rtl ? 'ArrowRight' : 'ArrowLeft'
    const nextKey = rtl ? 'ArrowLeft' : 'ArrowRight'

    if (event.key === previousKey && index > 0) {
      event.preventDefault()
      chipButtonRef.current[index - 1]?.focus()
    } else if (event.key === nextKey) {
      event.preventDefault()
      if (index < recipients.length - 1) chipButtonRef.current[index + 1]?.focus()
      else focusInput()
    }
  }

  return (
    <Field name="emails" invalid={Boolean(fieldError)}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>{t(($) => $['members.emailRecipients'], { ns: 'common' })}</FieldLabel>
        {recipients.length > 0 && (
          <span aria-live="polite" className="py-1 body-xs-regular text-text-tertiary tabular-nums">
            {t(($) => $['members.recipientCount'], {
              ns: 'common',
              count: recipients.length,
            })}
          </span>
        )}
      </div>
      <div
        className={cn(
          'flex max-h-24 min-h-10 flex-wrap content-start items-center gap-1 overflow-y-auto rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-1.5 transition-[background-color,border-color,box-shadow]',
          'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
          'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
          fieldError &&
            'border-components-input-border-destructive bg-components-input-bg-destructive',
          disabled &&
            'cursor-not-allowed bg-components-input-bg-disabled hover:border-transparent hover:bg-components-input-bg-disabled',
        )}
      >
        {recipients.length > 0 && (
          <ul
            aria-label={t(($) => $['members.emailRecipients'], { ns: 'common' })}
            className="contents"
          >
            {recipients.map(({ value, isValid }, index) => {
              const errorId = `email-recipient-${encodeURIComponent(value)}-error`

              return (
                <li
                  key={value}
                  className={cn(
                    'flex h-6 max-w-full items-center gap-1 rounded-md bg-components-badge-bg-gray-soft px-2 system-xs-medium text-text-secondary outline-hidden',
                    'focus-within:inset-ring-1 focus-within:inset-ring-components-input-border-active',
                    !isValid && 'bg-components-badge-bg-red-soft text-text-destructive',
                  )}
                >
                  <button
                    ref={(node) => {
                      chipButtonRef.current[index] = node
                    }}
                    type="button"
                    tabIndex={-1}
                    disabled={disabled}
                    aria-label={
                      isValid
                        ? value
                        : `${t(($) => $['operation.edit'], { ns: 'common' })} ${value}`
                    }
                    aria-describedby={!isValid ? errorId : undefined}
                    className="flex min-w-0 items-center gap-1 truncate text-start outline-hidden"
                    onKeyDown={(event) => handleChipKeyDown(event, index, isValid)}
                    onClick={() => {
                      if (isValid) focusInput()
                      else editRecipient(index)
                    }}
                  >
                    {!isValid && (
                      <span
                        aria-hidden="true"
                        className="i-ri-error-warning-fill size-3.5 shrink-0"
                      />
                    )}
                    <span className="truncate">{value}</span>
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={disabled}
                    aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${value}`}
                    className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => removeRecipient(index, 'input')}
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
          ref={inputRef}
          type="email"
          multiple
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          inputMode="email"
          placeholder={
            recipients.length === 0
              ? t(($) => $['members.emailPlaceholder'], { ns: 'common' }) || ''
              : ''
          }
          value={draft}
          className={cn(
            'h-6 flex-1 rounded-none border-0 bg-transparent p-0 shadow-none hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent focus:shadow-none data-invalid:border-transparent data-invalid:bg-transparent',
            recipients.length > 0 ? 'min-w-12' : 'min-w-40',
          )}
          onChange={(event) => {
            updateDraft(event.target.value)
            setDraftTouched(false)
          }}
          onBlur={() => setDraftTouched(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              if (event.key === 'Enter') event.preventDefault()
              return
            }

            if (event.key === 'Enter' && draft.trim()) {
              event.preventDefault()
              commitDraft()
              return
            }

            if (event.key === 'Backspace' && !draft && recipients.length > 0) {
              event.preventDefault()
              updateRecipients(recipients.slice(0, -1))
              return
            }

            const rtl = isRightToLeft(event.currentTarget)
            const chipNavigationKey = rtl ? 'ArrowRight' : 'ArrowLeft'
            if (event.key === chipNavigationKey && !draft && recipients.length > 0) {
              event.preventDefault()
              chipButtonRef.current[recipients.length - 1]?.focus()
            }
          }}
          onPaste={(event) => {
            const pastedText = event.clipboardData.getData('text')
            if (!hasEmailDelimiter(pastedText)) return

            event.preventDefault()
            updateRecipients(mergeEmailRecipients(recipients, pastedText))
            setDraftTouched(false)
          }}
        />
      </div>
      {fieldError ? (
        <FieldError>{fieldError}</FieldError>
      ) : (
        <FieldDescription>
          {t(($) => $['members.emailRecipientsTip'], { ns: 'common' })}
        </FieldDescription>
      )}
    </Field>
  )
}
