import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
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
  const [invalid, setInvalid] = useState(false)

  const showValidationError = (message: string) => {
    setInvalid(true)
    toast.error(message)
  }

  const submit = async (onBlur: boolean) => {
    if (pending) return
    if (onBlur && (invalid || (initialName === undefined && !draft))) return
    const name = draft === initialName ? draft : draft.trim()
    if (name === initialName) {
      onFinish?.()
      return
    }
    if (!name) {
      showValidationError(t(($) => $['tag.nameRequired']))
      return
    }
    if (isTagNameTooLong(name)) {
      showValidationError(t(($) => $['tag.nameTooLong'], { max: MAX_TAG_NAME_LENGTH }))
      return
    }
    if (tags.some((other) => other.id !== tag?.id && other.name.trim() === name)) {
      showValidationError(t(($) => $['tag.nameAlreadyExists']))
      return
    }
    try {
      await onSave(name)
      setDraft('')
      setInvalid(false)
      onFinish?.()
    } catch (cause) {
      const message = getTagNameValidationMessage(
        cause,
        t,
        initialName === undefined ? 'create' : 'rename',
      )
      if (message) showValidationError(message)
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
        aria-invalid={invalid || undefined}
        ref={initialName !== undefined ? focusRenameInput : undefined}
        className={inputClassName}
        placeholder={initialName === undefined ? label : undefined}
        value={draft}
        readOnly={pending}
        onChange={(event) => {
          setDraft(event.target.value)
          setInvalid(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
        }}
        onBlur={() => void submit(true)}
      />
    </form>
  )
}
