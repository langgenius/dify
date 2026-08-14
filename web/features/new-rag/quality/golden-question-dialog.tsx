'use client'

import type { FormEvent } from 'react'
import type { GoldenQuestionDraft, GoldenQuestionEvidenceOption } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldItem, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type DialogMode = 'create' | 'edit' | 'promote'
type MatchPolicy = GoldenQuestionDraft['matchPolicy']

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status
  if (!error || typeof error !== 'object') return undefined
  const status = 'status' in error ? error.status : undefined
  if (typeof status === 'number') return status
  const data = 'data' in error ? error.data : undefined
  if (!data || typeof data !== 'object') return undefined
  const dataStatus = 'status' in data ? data.status : undefined
  return typeof dataStatus === 'number' ? dataStatus : undefined
}

export function GoldenQuestionDialog({
  evidenceOptions = [],
  error,
  initialValue,
  knowledgeSpaceId,
  mode,
  onOpenChange,
  onSubmit,
  open,
  pending = false,
}: {
  evidenceOptions?: readonly GoldenQuestionEvidenceOption[]
  error?: string
  initialValue: GoldenQuestionDraft
  knowledgeSpaceId: string
  mode: DialogMode
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: GoldenQuestionDraft) => Promise<void>
  open: boolean
  pending?: boolean
}) {
  const { t } = useTranslation('dataset')
  const [question, setQuestion] = useState(initialValue.question)
  const [annotation, setAnnotation] = useState(initialValue.annotation)
  const [evidenceText, setEvidenceText] = useState(initialValue.evidenceText)
  const [expectedEvidenceIds, setExpectedEvidenceIds] = useState(initialValue.expectedEvidenceIds)
  const [matchPolicy, setMatchPolicy] = useState(initialValue.matchPolicy)
  const [tags, setTags] = useState(initialValue.tags.join(', '))
  const [questionInvalid, setQuestionInvalid] = useState(false)
  const [annotationInvalid, setAnnotationInvalid] = useState(false)
  const [matchError, setMatchError] = useState<'unavailable' | 'unknown'>()
  const matchMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.evidenceMatches.post.mutationOptions(),
  )
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
    const nextQuestionInvalid = !question.trim()
    const nextAnnotationInvalid = !annotation.trim()
    setQuestionInvalid(nextQuestionInvalid)
    setAnnotationInvalid(nextAnnotationInvalid)
    if (nextQuestionInvalid || nextAnnotationInvalid) return
    await onSubmit({
      annotation: annotation.trim(),
      evidenceText: evidenceText.trim(),
      expectedEvidenceIds,
      matchPolicy,
      question: question.trim(),
      tags: [...new Set(parseTags(tags))],
    })
  }

  const findEvidence = async () => {
    if (!evidenceText.trim()) return
    setMatchError(undefined)
    try {
      await matchMutation.mutateAsync({
        body: { evidence: evidenceText.trim() },
        params: { control_space_id: knowledgeSpaceId },
      })
    } catch (error) {
      setMatchError(errorStatus(error) === 503 ? 'unavailable' : 'unknown')
    }
  }

  const candidatesByNodeId = new Map<string, GoldenQuestionEvidenceOption>(
    evidenceOptions.map((candidate) => [candidate.node_id, candidate]),
  )
  for (const candidate of matchMutation.data?.candidates ?? [])
    candidatesByNodeId.set(candidate.node_id, candidate)
  const candidates = [...candidatesByNodeId.values()]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop className="bg-[rgba(16,24,40,0.2)]" />
        <DialogPopup className="fixed top-1/2 left-1/2 max-h-[calc(100vh-2rem)] w-140 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border-0 p-6 shadow-xl">
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
                onValueChange={(value) => {
                  setQuestion(value)
                  if (value.trim()) setQuestionInvalid(false)
                }}
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
                className={mode === 'edit' ? 'h-22 min-h-22 resize-y' : 'h-16 min-h-16 resize-y'}
                placeholder={t(($) => $['newKnowledge.qualityPage.annotationPlaceholder'])}
                value={annotation}
                onValueChange={(value) => {
                  setAnnotation(value)
                  if (value.trim()) setAnnotationInvalid(false)
                }}
              />
              {annotationInvalid && (
                <FieldError match className="py-0.5 body-xs-regular text-text-destructive">
                  {t(($) => $['newKnowledge.qualityPage.annotationRequired'])}
                </FieldError>
              )}
              {!annotationInvalid && error && <FieldError match>{error}</FieldError>}
            </Field>
            <div className="grid min-w-0 gap-1">
              <Field name="evidence">
                <FieldLabel>{t(($) => $['newKnowledge.qualityPage.evidence'])}</FieldLabel>
                <Textarea
                  className="h-20 resize-y"
                  placeholder={t(($) => $['newKnowledge.qualityPage.evidencePlaceholder'])}
                  value={evidenceText}
                  onValueChange={(value) => {
                    setEvidenceText(value)
                    setMatchError(undefined)
                    matchMutation.reset()
                  }}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="system-xs-regular text-text-tertiary">
                    {expectedEvidenceIds.length > 0
                      ? t(($) => $['newKnowledge.qualityPage.evidenceSelected'], {
                          count: expectedEvidenceIds.length,
                        })
                      : t(($) => $['newKnowledge.qualityPage.noEvidenceSelected'])}
                  </span>
                  <div className="flex gap-2">
                    {expectedEvidenceIds.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending || matchMutation.isPending}
                        onClick={() => setExpectedEvidenceIds([])}
                      >
                        {t(($) => $['newKnowledge.qualityPage.clearEvidence'])}
                      </Button>
                    )}
                    <Button
                      type="button"
                      loading={matchMutation.isPending}
                      disabled={!evidenceText.trim() || pending || matchMutation.isPending}
                      onClick={() => void findEvidence()}
                    >
                      {t(($) => $['newKnowledge.qualityPage.findEvidence'])}
                    </Button>
                  </div>
                </div>
                {matchError && (
                  <FieldError match>
                    {matchError === 'unavailable'
                      ? t(($) => $['newKnowledge.qualityPage.noEvidenceMatch'])
                      : t(($) => $.unknownError)}
                  </FieldError>
                )}
                {matchMutation.isSuccess && (matchMutation.data?.candidates.length ?? 0) === 0 && (
                  <p className="mt-2 body-xs-regular text-text-tertiary">
                    {t(($) => $['newKnowledge.qualityPage.noEvidenceMatch'])}
                  </p>
                )}
              </Field>
              {candidates.length > 0 && (
                <Field name="expectedEvidenceIds">
                  <Fieldset
                    className="mt-2 flex max-h-52 flex-col gap-2 overflow-y-auto rounded-lg border border-divider-subtle p-2"
                    render={
                      <CheckboxGroup
                        value={expectedEvidenceIds}
                        onValueChange={setExpectedEvidenceIds}
                      />
                    }
                  >
                    <FieldsetLegend className="sr-only">
                      {t(($) => $['newKnowledge.qualityPage.evidence'])}
                    </FieldsetLegend>
                    {candidates.map((candidate) => (
                      <FieldItem key={candidate.node_id}>
                        <FieldLabel className="flex w-full cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-state-base-hover">
                          <Checkbox className="mt-0.5" value={candidate.node_id} />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 body-xs-regular text-text-secondary">
                              {candidate.text || candidate.section_path.join(' / ')}
                            </span>
                            <span className="mt-1 block system-2xs-medium-uppercase text-text-tertiary">
                              {candidate.section_path.join(' / ') ||
                                t(($) => $['newKnowledge.qualityPage.evidence'])}
                              {candidate.score !== undefined && (
                                <>
                                  {' · '}
                                  {Math.round(candidate.score * 100)}%
                                </>
                              )}
                            </span>
                          </span>
                        </FieldLabel>
                      </FieldItem>
                    ))}
                  </Fieldset>
                </Field>
              )}
            </div>
            {expectedEvidenceIds.length > 1 && (
              <Field name="matchPolicy">
                <Fieldset
                  render={
                    <RadioGroup<MatchPolicy>
                      className="flex-col items-start gap-1"
                      required
                      value={matchPolicy}
                      onValueChange={setMatchPolicy}
                    />
                  }
                >
                  <FieldsetLegend className="mb-0 w-fit">
                    {t(($) => $['newKnowledge.qualityPage.matchPolicyLabel'])}
                  </FieldsetLegend>
                  <div className="flex gap-2">
                    {(['all', 'any'] as const).map((policy) => (
                      <RadioItem<MatchPolicy>
                        key={policy}
                        value={policy}
                        nativeButton
                        render={
                          <Button
                            type="button"
                            variant={matchPolicy === policy ? 'secondary' : 'ghost'}
                          />
                        }
                      >
                        {t(($) => $[`newKnowledge.qualityPage.matchPolicy.${policy}`])}
                      </RadioItem>
                    ))}
                  </div>
                </Fieldset>
              </Field>
            )}
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
