'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import robotAvatar from '../../assets/robot-avatar.svg'

export const EditItemType = { Query: 'query', Answer: 'answer' } as const
export type EditItemType = (typeof EditItemType)[keyof typeof EditItemType]

type EditItemProps = {
  type: EditItemType
  content: string
  savedContent: string
  readonly?: boolean
  isPending: boolean
  onSave: (content: string, onSuccess: () => void) => void
}

type EditTitleProps = { className?: string; title: string }

export function EditTitle({ className, title }: EditTitleProps) {
  return (
    <div className={cn(className, 'flex h-4.5 items-center system-xs-medium text-text-tertiary')}>
      <span aria-hidden className="me-1 i-ri-edit-fill size-3.5" />
      <span>{title}</span>
      <div className="ms-2 h-px grow bg-linear-to-r from-divider-subtle to-transparent" />
    </div>
  )
}

function focusEditor(element: HTMLTextAreaElement | null) {
  element?.focus()
}

export default function EditItem({
  type,
  readonly,
  content,
  savedContent,
  isPending,
  onSave,
}: EditItemProps) {
  const { t } = useTranslation(['appAnnotation', 'common'])
  const [isEdit, setIsEdit] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const restoreEditFocus = useRef(false)
  useLayoutEffect(() => {
    if (restoreEditFocus.current && !isEdit && !isPending) {
      editButtonRef.current?.focus()
      restoreEditFocus.current = false
    }
  }, [isEdit, isPending])
  const isQuestion = type === EditItemType.Query
  const name = isQuestion
    ? t(($) => $['editModal.queryName'], { ns: 'appAnnotation' })
    : t(($) => $['editModal.answerName'], { ns: 'appAnnotation' })
  const editTitle = isQuestion
    ? t(($) => $['editModal.yourQuery'], { ns: 'appAnnotation' })
    : t(($) => $['editModal.yourAnswer'], { ns: 'appAnnotation' })
  const finishEditing = () => {
    restoreEditFocus.current = true
    setIsEdit(false)
  }

  return (
    <section aria-label={name} className="min-w-0 space-y-2">
      <div className="flex items-center gap-2 system-sm-semibold text-text-primary">
        {isQuestion ? (
          <span aria-hidden className="i-custom-public-avatar-user size-6 shrink-0" />
        ) : (
          <img aria-hidden src={robotAvatar.src} alt="" width={24} height={24} />
        )}
        {name}
      </div>
      <p className="system-sm-regular wrap-break-word whitespace-pre-wrap text-text-primary">
        {content}
      </p>
      {!isEdit && savedContent !== content && (
        <div className="space-y-1">
          <EditTitle title={editTitle} />
          <p className="system-sm-regular wrap-break-word whitespace-pre-wrap text-text-primary">
            {savedContent}
          </p>
        </div>
      )}
      {!readonly && (
        <div className="flex gap-2">
          <Button
            ref={editButtonRef}
            size="small"
            variant="ghost"
            disabled={isPending}
            aria-expanded={isEdit}
            onClick={() => setIsEdit(true)}
          >
            <span aria-hidden className="i-ri-edit-line size-3.5" />
            {t(($) => $['operation.edit'], { ns: 'common' })}
          </Button>
          {!isEdit && savedContent !== content && (
            <Button
              size="small"
              variant="ghost"
              disabled={isPending}
              onClick={() => onSave(content, finishEditing)}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </Button>
          )}
        </div>
      )}
      {isEdit && (
        <Form<{ content: string }>
          onFormSubmit={({ content }) => {
            if (!isPending) onSave(content, finishEditing)
          }}
        >
          <Field name="content">
            <FieldLabel>{editTitle}</FieldLabel>
            <Textarea
              ref={focusEditor}
              defaultValue={savedContent}
              required
              readOnly={isPending}
              placeholder={
                isQuestion
                  ? t(($) => $['editModal.queryPlaceholder'], { ns: 'appAnnotation' })
                  : t(($) => $['editModal.answerPlaceholder'], { ns: 'appAnnotation' })
              }
            />
            <FieldError match="valueMissing">
              {isQuestion
                ? t(($) => $['errorMessage.queryRequired'], { ns: 'appAnnotation' })
                : t(($) => $['errorMessage.answerRequired'], { ns: 'appAnnotation' })}
            </FieldError>
          </Field>
          <div className="mt-2 flex gap-2">
            <Button type="submit" size="small" variant="primary" loading={isPending}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
            <Button size="small" disabled={isPending} onClick={finishEditing}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
          </div>
        </Form>
      )}
    </section>
  )
}
