'use client'

import type { FormEvent } from 'react'
import type { GoldenQuestionDraft } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type DialogMode = 'create' | 'edit' | 'promote'

export function GoldenQuestionDialog({
  error,
  initialValue,
  mode,
  onOpenChange,
  onSubmit,
  open,
  pending = false,
}: {
  error?: string
  initialValue: GoldenQuestionDraft
  mode: DialogMode
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: GoldenQuestionDraft) => Promise<void>
  open: boolean
  pending?: boolean
}) {
  const { t } = useTranslation('dataset')
  const [question, setQuestion] = useState(initialValue.question)
  const [annotation, setAnnotation] = useState(initialValue.annotation)
  const [tags, setTags] = useState(initialValue.tags.join(', '))
  const [submitted, setSubmitted] = useState(false)
  const questionInvalid = submitted && !question.trim()
  const annotationInvalid = submitted && !annotation.trim()
  const title =
    mode === 'create'
      ? t(($) => $['newKnowledge.qualityPage.createTitle'])
      : mode === 'edit'
        ? t(($) => $['newKnowledge.qualityPage.editTitle'])
        : t(($) => $['newKnowledge.qualityPage.promoteTitle'])
  const submitLabel =
    mode === 'promote'
      ? t(($) => $['newKnowledge.qualityPage.promote'])
      : t(($) => $['newKnowledge.qualityPage.save'])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (!question.trim() || !annotation.trim()) return
    await onSubmit({
      annotation: annotation.trim(),
      question: question.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop className="bg-[rgba(16,24,40,0.2)]" />
        <DialogPopup className="fixed top-1/2 left-1/2 w-140 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border-0 p-6 shadow-xl">
          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            <div className="flex items-center justify-between">
              <DialogTitle className="system-md-semibold text-text-primary">{title}</DialogTitle>
              <DialogCloseButton
                aria-label={t(($) => $['newKnowledge.qualityPage.closeDialog'])}
                className="static size-5"
              />
            </div>
            <Field name="question" invalid={questionInvalid}>
              <FieldLabel>
                {t(($) => $['newKnowledge.qualityPage.question'])}
                <span className="ml-0.5 text-text-destructive">*</span>
              </FieldLabel>
              <Textarea
                aria-invalid={questionInvalid}
                className="h-22 resize-y"
                placeholder={t(($) => $['newKnowledge.qualityPage.questionPlaceholder'])}
                value={question}
                onValueChange={setQuestion}
              />
              {questionInvalid && (
                <FieldError match className="py-0.5 body-xs-regular text-text-destructive">
                  {t(($) => $['newKnowledge.qualityPage.questionRequired'])}
                </FieldError>
              )}
            </Field>
            <Field name="annotation" invalid={annotationInvalid || Boolean(error)}>
              <FieldLabel>
                {t(($) => $['newKnowledge.qualityPage.annotation'])}
                <span className="ml-0.5 text-text-destructive">*</span>
              </FieldLabel>
              <Textarea
                aria-invalid={annotationInvalid}
                className="h-16 resize-y"
                placeholder={t(($) => $['newKnowledge.qualityPage.annotationPlaceholder'])}
                value={annotation}
                onValueChange={setAnnotation}
              />
              {annotationInvalid && (
                <FieldError match className="py-0.5 body-xs-regular text-text-destructive">
                  {t(($) => $['newKnowledge.qualityPage.annotationRequired'])}
                </FieldError>
              )}
              {!annotationInvalid && error && <FieldError match>{error}</FieldError>}
            </Field>
            <Field name="tags">
              <FieldLabel>{t(($) => $['newKnowledge.qualityPage.tags'])}</FieldLabel>
              <Input
                placeholder={t(($) => $['newKnowledge.qualityPage.tagsPlaceholder'])}
                value={tags}
                onValueChange={setTags}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" disabled={pending} onClick={() => onOpenChange(false)}>
                {t(($) => $['newKnowledge.qualityPage.cancel'])}
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
