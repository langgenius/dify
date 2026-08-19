'use client'

import type { FormEvent, KeyboardEvent } from 'react'
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
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
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
  const { t: tCommon } = useTranslation('common')
  const [question, setQuestion] = useState(initialValue.question)
  const [annotation, setAnnotation] = useState(initialValue.annotation)
  const [evidenceQuery, setEvidenceQuery] = useState('')
  const [expectedEvidenceIds, setExpectedEvidenceIds] = useState(initialValue.expectedEvidenceIds)
  const [evidenceByNodeId, setEvidenceByNodeId] = useState(
    () => new Map(evidenceOptions.map((option) => [option.node_id, option])),
  )
  const [matchPolicy, setMatchPolicy] = useState(initialValue.matchPolicy)
  const [tags, setTags] = useState(initialValue.tags.join(', '))
  const [questionInvalid, setQuestionInvalid] = useState(false)
  const [matchError, setMatchError] = useState<'unavailable' | 'unknown'>()
  const mergeEvidenceOptions = useCallback((options: readonly GoldenQuestionEvidenceOption[]) => {
    setEvidenceByNodeId((current) => {
      const next = new Map(current)
      for (const option of options) next.set(option.node_id, option)
      return next
    })
  }, [])
  const matchMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.evidenceMatches.post.mutationOptions(),
  )
  const resolveMutation = useMutation({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.evidenceMatches.post.mutationOptions(),
    onSuccess: (data) => mergeEvidenceOptions(data.candidates),
  })
  const unresolvedInitialEvidenceKey = initialValue.expectedEvidenceIds
    .filter((nodeId) => !evidenceByNodeId.has(nodeId))
    .join(',')
  const resolveEvidence = resolveMutation.mutate
  useEffect(() => {
    if (!unresolvedInitialEvidenceKey) return
    resolveEvidence({
      body: { node_ids: unresolvedInitialEvidenceKey.split(',') },
      params: { control_space_id: knowledgeSpaceId },
    })
  }, [knowledgeSpaceId, resolveEvidence, unresolvedInitialEvidenceKey])
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
    setQuestionInvalid(nextQuestionInvalid)
    if (nextQuestionInvalid) return
    await onSubmit({
      annotation: annotation.trim(),
      expectedEvidenceIds,
      matchPolicy,
      question: question.trim(),
      tags: [...new Set(parseTags(tags))],
    })
  }

  const findEvidence = async () => {
    const query = evidenceQuery.trim()
    if (!query) return
    setMatchError(undefined)
    try {
      const result = await matchMutation.mutateAsync({
        body: { evidence: query },
        params: { control_space_id: knowledgeSpaceId },
      })
      mergeEvidenceOptions(result.candidates)
      setEvidenceQuery('')
    } catch (error) {
      setMatchError(errorStatus(error) === 503 ? 'unavailable' : 'unknown')
    }
  }

  const handleEvidenceSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void findEvidence()
  }

  const searchCandidates = matchMutation.data?.candidates ?? evidenceOptions
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
            <Field name="annotation" invalid={Boolean(error)}>
              <FieldLabel>{t(($) => $['newKnowledge.qualityPage.annotation'])}</FieldLabel>
              <Textarea
                aria-invalid={Boolean(error)}
                className={mode === 'edit' ? 'h-22 min-h-22 resize-y' : 'h-16 min-h-16 resize-y'}
                placeholder={t(($) => $['newKnowledge.qualityPage.annotationPlaceholder'])}
                value={annotation}
                onValueChange={setAnnotation}
              />
              {error && <FieldError match>{error}</FieldError>}
            </Field>
            <div className="grid min-w-0 gap-4">
              <Field name="expectedEvidenceIds">
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>{t(($) => $['newKnowledge.qualityPage.evidence'])}</FieldLabel>
                  {expectedEvidenceIds.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setExpectedEvidenceIds([])}
                    >
                      {t(($) => $['newKnowledge.qualityPage.clearEvidence'])}
                    </Button>
                  )}
                </div>
                <p className="body-xs-regular text-text-tertiary">
                  {expectedEvidenceIds.length > 0
                    ? t(($) => $['newKnowledge.qualityPage.evidenceSelected'], {
                        count: expectedEvidenceIds.length,
                      })
                    : t(($) => $['newKnowledge.qualityPage.noEvidenceSelected'])}
                </p>
                {expectedEvidenceIds.length > 0 && (
                  <div className="mt-2 flex max-h-52 flex-col gap-2 overflow-y-auto rounded-lg border border-divider-subtle p-2">
                    {expectedEvidenceIds.map((nodeId) => {
                      const evidence = evidenceByNodeId.get(nodeId)
                      return (
                        <div
                          key={nodeId}
                          className="flex items-start gap-2 rounded-md bg-background-section-burn p-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="body-xs-regular whitespace-pre-wrap text-text-secondary">
                              {evidence?.text || nodeId}
                            </p>
                            <p className="mt-1 system-2xs-medium-uppercase text-text-tertiary">
                              {evidence?.section_path.join(' / ') ||
                                t(($) => $['newKnowledge.qualityPage.goldenStatus.stale'])}
                            </p>
                          </div>
                          <IconButton
                            type="button"
                            size="sm"
                            disabled={pending}
                            aria-label={`${tCommon(($) => $['operation.remove'])}: ${evidence?.text || nodeId}`}
                            onClick={() =>
                              setExpectedEvidenceIds((current) =>
                                current.filter((currentId) => currentId !== nodeId),
                              )
                            }
                          >
                            <span aria-hidden className="i-ri-close-line size-4" />
                          </IconButton>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Field>
              <Field name="evidenceSearch">
                <FieldLabel>{t(($) => $['newKnowledge.qualityPage.findEvidence'])}</FieldLabel>
                <div className="flex items-center gap-2">
                  <SearchInput
                    name="evidence-search"
                    aria-label={t(($) => $['newKnowledge.qualityPage.findEvidence'])}
                    className="min-w-0 flex-1"
                    disabled={pending || matchMutation.isPending}
                    placeholder={t(($) => $['newKnowledge.qualityPage.evidencePlaceholder'])}
                    value={evidenceQuery}
                    onKeyDown={handleEvidenceSearchKeyDown}
                    onValueChange={(value) => {
                      setEvidenceQuery(value)
                      setMatchError(undefined)
                      matchMutation.reset()
                    }}
                  />
                  <Button
                    type="button"
                    loading={matchMutation.isPending}
                    disabled={!evidenceQuery.trim() || pending || matchMutation.isPending}
                    onClick={() => void findEvidence()}
                  >
                    {t(($) => $['newKnowledge.qualityPage.findEvidence'])}
                  </Button>
                </div>
                {matchError && (
                  <FieldError match>
                    {matchError === 'unavailable'
                      ? t(($) => $['newKnowledge.qualityPage.noEvidenceMatch'])
                      : t(($) => $.unknownError)}
                  </FieldError>
                )}
                {matchMutation.isSuccess && searchCandidates.length === 0 && (
                  <p className="mt-2 body-xs-regular text-text-tertiary">
                    {t(($) => $['newKnowledge.qualityPage.noEvidenceMatch'])}
                  </p>
                )}
              </Field>
              {searchCandidates.length > 0 && (
                <Field name="evidenceSearchResults">
                  <Fieldset
                    className="flex max-h-52 flex-col gap-2 overflow-y-auto rounded-lg border border-divider-subtle p-2"
                    render={
                      <CheckboxGroup
                        value={expectedEvidenceIds}
                        onValueChange={setExpectedEvidenceIds}
                      />
                    }
                  >
                    <FieldsetLegend className="sr-only">
                      {t(($) => $['newKnowledge.qualityPage.findEvidence'])}
                    </FieldsetLegend>
                    {searchCandidates.map((candidate) => (
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
                              {candidate.score !== undefined && candidate.score !== null && (
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
