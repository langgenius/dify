import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isTagNameTooLong, MAX_TAG_NAME_LENGTH } from './tag-name-length'
import { getTagNameValidationMessage } from './tag-name-validation'

type TagNameFormProps = {
  tag?: TagResponse
  tags: readonly TagResponse[]
  label: string
  inputClassName: string
  pending: boolean
  onSave: (name: string) => Promise<unknown>
  onSaveError: (error: unknown) => void
  onFinish?: () => void
}

function focusRenameInput(input: HTMLInputElement | null) {
  input?.focus()
}

export function TagNameForm({
  tag,
  tags,
  label,
  inputClassName,
  pending,
  onSave,
  onSaveError,
  onFinish,
}: TagNameFormProps) {
  const { t } = useTranslation(['common'])
  const initialName = tag?.name
  const [draft, setDraft] = useState(initialName ?? '')
  const [error, setError] = useState('')
  const errorId = useId()

  const submit = async (onBlur: boolean) => {
    if (pending) return
    if (onBlur && (error || (initialName === undefined && !draft))) return
    const name = draft.trim()
    if (!name) {
      setError(t(($) => $['tag.nameRequired']))
      return
    }
    if (isTagNameTooLong(name)) {
      setError(t(($) => $['tag.nameTooLong'], { max: MAX_TAG_NAME_LENGTH }))
      return
    }
    if (name === initialName) {
      onFinish?.()
      return
    }
    if (tags.some((other) => other.id !== tag?.id && other.name.trim() === name)) {
      setError(t(($) => $['tag.nameAlreadyExists']))
      return
    }
    try {
      await onSave(name)
      setDraft('')
      onFinish?.()
    } catch (cause) {
      const message = getTagNameValidationMessage(
        cause,
        t,
        initialName === undefined ? 'create' : 'rename',
      )
      if (message) setError(message)
      else onSaveError(cause)
    }
  }

  return (
    <form
      className="max-w-full min-w-0"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(false)
      }}
    >
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        ref={initialName !== undefined ? focusRenameInput : undefined}
        className={inputClassName}
        placeholder={initialName === undefined ? label : undefined}
        value={draft}
        readOnly={pending}
        onChange={(event) => {
          setDraft(event.target.value)
          setError('')
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
        }}
        onBlur={() => void submit(true)}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 system-xs-regular text-text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
