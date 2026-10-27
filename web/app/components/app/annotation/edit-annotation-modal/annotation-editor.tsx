import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditItem, { EditItemType } from './edit-item'

export type AnnotationEditorProps = {
  question: string
  answer: string
  onlyEditResponse?: boolean
  isPending: boolean
  isError: boolean
  onSave: (body: { question: string; answer: string }, onSuccess: () => void) => void
}

export function AnnotationEditor({
  question,
  answer,
  onlyEditResponse,
  isPending,
  isError,
  onSave,
}: AnnotationEditorProps) {
  const { t } = useTranslation(['common'])
  const [saved, setSaved] = useState({ question, answer })
  return (
    <div className="space-y-6">
      <EditItem
        type={EditItemType.Query}
        content={question}
        savedContent={saved.question}
        readonly={onlyEditResponse}
        isPending={isPending}
        onSave={(question, onSuccess) => {
          const body = { ...saved, question }
          onSave(body, () => {
            setSaved(body)
            onSuccess()
          })
        }}
      />
      <EditItem
        type={EditItemType.Answer}
        content={answer}
        savedContent={saved.answer}
        isPending={isPending}
        onSave={(answer, onSuccess) => {
          const body = { ...saved, answer }
          onSave(body, () => {
            setSaved(body)
            onSuccess()
          })
        }}
      />
      {isError && (
        <p role="alert" className="system-sm-regular text-text-destructive">
          {t(($) => $['api.actionFailed'], { ns: 'common' })}
        </p>
      )}
    </div>
  )
}
