'use client'

import type { FormEvent, KeyboardEvent } from 'react'
import type { GoldenQuestionDraft, GoldenQuestionEvidenceOption } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldItem, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { consoleQuery } from '@/service/console'

type DialogMode = 'create' | 'edit' | 'promote'
type MatchPolicy = GoldenQuestionDraft['matchPolicy']

type GoldenQuestionDialogProps = {
  evidenceOptions?: readonly GoldenQuestionEvidenceOption[]
  error?: string
  initialValue: GoldenQuestionDraft
  knowledgeSpaceId: string
  mode: DialogMode
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: GoldenQuestionDraft) => Promise<void>
  open: boolean
  pending?: boolean
  sessionKey?: string
}

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
  evidenceOptions,
  error,
  initialValue,
  knowledgeSpaceId,
  mode,
  onOpenChange,
  onSubmit,
  open,
  pending,
  sessionKey,
}: GoldenQuestionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop className="bg-[rgba(16,24,40,0.2)]" />
        <DialogViewport className="flex items-center justify-center overflow-hidden p-4">
          <GoldenQuestionDialogSession
            key={sessionKey}
            evidenceOptions={evidenceOptions}
            error={error}
            initialValue={initialValue}
            knowledgeSpaceId={knowledgeSpaceId}
            mode={mode}
            onOpenChange={onOpenChange}
            onSubmit={onSubmit}
            pending={pending}
          />
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  )
}

function GoldenQuestionDialogSession({
  evidenceOptions = [],
  error,
  initialValue,
  knowledgeSpaceId,
  mode,
  onOpenChange,
  onSubmit,
  pending = false,
}: Omit<GoldenQuestionDialogProps, 'open' | 'sessionKey'>) {
  const { i18n, t } = useTranslation(['dataset', 'knowledgeQuality', 'knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const [question, setQuestion] = useState(initialValue.question)
  const [annotation, setAnnotation] = useState(initialValue.annotation)
  const [evidenceQuery, setEvidenceQuery] = useState('')
  const [expectedEvidenceIds, setExpectedEvidenceIds] = useState(initialValue.expectedEvidenceIds)
  const [matchedEvidenceByNodeId, setMatchedEvidenceByNodeId] = useState(
    () => new Map<string, GoldenQuestionEvidenceOption>(),
  )
  const [matchPolicy, setMatchPolicy] = useState(initialValue.matchPolicy)
  const [tags, setTags] = useState(initialValue.tags.join(', '))
  const [questionInvalid, setQuestionInvalid] = useState(false)
  const [matchError, setMatchError] = useState<'unavailable' | 'unknown'>()
  const mergeEvidenceOptions = (options: readonly GoldenQuestionEvidenceOption[]) => {
    setMatchedEvidenceByNodeId((current) => {
      const next = new Map(current)
      for (const option of options) next.set(option.node_id, option)
      return next
    })
  }
  const evidenceByNodeId = new Map(
    evidenceOptions.map((option) => [option.node_id, option] as const),
  )
  for (const [nodeId, option] of matchedEvidenceByNodeId) evidenceByNodeId.set(nodeId, option)
  const matchMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.evidenceMatches.post.mutationOptions(),
  )
  const title =
    mode === 'create'
      ? t(($) => $['qualityPage.createTitle'], { ns: 'knowledgeQuality' })
      : mode === 'edit'
        ? t(($) => $['qualityPage.editTitle'], { ns: 'knowledgeQuality' })
        : t(($) => $['qualityPage.promoteTitle'], { ns: 'knowledgeQuality' })
  const submitLabel =
    mode === 'promote'
      ? t(($) => $['qualityPage.promote'], { ns: 'knowledgeQuality' })
      : t(($) => $['qualityPage.save'], { ns: 'knowledgeQuality' })

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

  const searchCandidates =
    matchMutation.data?.candidates ??
    evidenceOptions.filter((option) => !initialValue.expectedEvidenceIds.includes(option.node_id))
  return (
    <DialogPopup className="relative flex max-h-[calc(100dvh-2rem)] w-140 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border-0 p-0 shadow-xl">
      <div className="relative z-1 flex shrink-0 items-center justify-between bg-components-panel-bg px-6 pt-6 pb-5">
        <DialogTitle className="system-md-semibold text-text-primary">{title}</DialogTitle>
        <DialogClose
          render={
            <IconButton
              size="lg"
              aria-label={t(($) => $['qualityPage.closeDialog'], { ns: 'knowledgeQuality' })}
              className="static"
            >
              <span aria-hidden className="i-ri-close-line size-5" />
            </IconButton>
          }
        />
      </div>
      <form
        className="flex min-h-0 flex-col gap-5 overflow-y-auto overscroll-contain px-6 pb-6"
        onSubmit={handleSubmit}
      >
        <Field name="question" invalid={questionInvalid}>
          <FieldLabel>
            {t(($) => $['qualityPage.question'], { ns: 'knowledgeSpace' })}
            <span className="ml-0.5 text-text-destructive">*</span>
          </FieldLabel>
          <Textarea
            aria-invalid={questionInvalid}
            className="h-22 resize-y"
            placeholder={t(($) => $['qualityPage.questionPlaceholder'], { ns: 'knowledgeQuality' })}
            value={question}
            onValueChange={(value) => {
              setQuestion(value)
              if (value.trim()) setQuestionInvalid(false)
            }}
          />
          {questionInvalid && (
            <FieldError match className="py-0.5 body-xs-regular text-text-destructive">
              {t(($) => $['qualityPage.questionRequired'], { ns: 'knowledgeQuality' })}
            </FieldError>
          )}
        </Field>
        <Field name="annotation" invalid={Boolean(error)}>
          <FieldLabel>
            {t(($) => $['qualityPage.annotation'], { ns: 'knowledgeQuality' })}
          </FieldLabel>
          <Textarea
            aria-invalid={Boolean(error)}
            className={mode === 'edit' ? 'h-22 min-h-22 resize-y' : 'h-16 min-h-16 resize-y'}
            placeholder={t(($) => $['qualityPage.annotationPlaceholder'], {
              ns: 'knowledgeQuality',
            })}
            value={annotation}
            onValueChange={setAnnotation}
          />
          {error && <FieldError match>{error}</FieldError>}
        </Field>
        <div className="grid min-w-0 gap-4">
          <Field name="expectedEvidenceIds">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>
                {t(($) => $['qualityPage.evidence'], { ns: 'knowledgeSpace' })}
              </FieldLabel>
              {expectedEvidenceIds.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setExpectedEvidenceIds([])}
                >
                  {t(($) => $['qualityPage.clearEvidence'], { ns: 'knowledgeQuality' })}
                </Button>
              )}
            </div>
            <p className="body-xs-regular text-text-tertiary">
              {expectedEvidenceIds.length > 0
                ? t(($) => $['qualityPage.evidenceSelected'], {
                    ns: 'knowledgeQuality',
                    count: expectedEvidenceIds.length,
                  })
                : t(($) => $['qualityPage.noEvidenceSelected'], { ns: 'knowledgeQuality' })}
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
                            t(($) => $['qualityPage.goldenStatus.stale'], {
                              ns: 'knowledgeQuality',
                            })}
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
            <FieldLabel>
              {t(($) => $['qualityPage.findEvidence'], { ns: 'knowledgeQuality' })}
            </FieldLabel>
            <div className="flex items-center gap-2">
              <SearchInput
                name="evidence-search"
                aria-label={t(($) => $['qualityPage.findEvidence'], { ns: 'knowledgeQuality' })}
                className="min-w-0 flex-1"
                disabled={pending || matchMutation.isPending}
                placeholder={t(($) => $['qualityPage.evidencePlaceholder'], {
                  ns: 'knowledgeQuality',
                })}
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
                disabled={!evidenceQuery.trim() || pending}
                onClick={() => void findEvidence()}
              >
                {t(($) => $['qualityPage.findEvidence'], { ns: 'knowledgeQuality' })}
              </Button>
            </div>
            {matchError && (
              <FieldError match>
                {matchError === 'unavailable'
                  ? t(($) => $['qualityPage.noEvidenceMatch'], { ns: 'knowledgeQuality' })
                  : t(($) => $.unknownError, { ns: 'dataset' })}
              </FieldError>
            )}
            {matchMutation.isSuccess && searchCandidates.length === 0 && (
              <p className="mt-2 body-xs-regular text-text-tertiary">
                {t(($) => $['qualityPage.noEvidenceMatch'], { ns: 'knowledgeQuality' })}
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
                  {t(($) => $['qualityPage.findEvidence'], { ns: 'knowledgeQuality' })}
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
                            t(($) => $['qualityPage.evidence'], { ns: 'knowledgeSpace' })}
                          {candidate.score !== undefined && candidate.score !== null && (
                            <>
                              {' · '}
                              {new Intl.NumberFormat(i18n.language, {
                                maximumFractionDigits: 0,
                                style: 'percent',
                              }).format(candidate.score)}
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
                {t(($) => $['qualityPage.matchPolicyLabel'], { ns: 'knowledgeQuality' })}
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
                    {t(($) => $[`qualityPage.matchPolicy.${policy}`], { ns: 'knowledgeQuality' })}
                  </RadioItem>
                ))}
              </div>
            </Fieldset>
          </Field>
        )}
        <Field name="tags">
          <FieldLabel>{t(($) => $['qualityPage.tags'], { ns: 'knowledgeQuality' })}</FieldLabel>
          <Input
            placeholder={t(($) => $['qualityPage.tagsPlaceholder'], { ns: 'knowledgeQuality' })}
            value={tags}
            onValueChange={setTags}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" disabled={pending} onClick={() => onOpenChange(false)}>
            {t(($) => $['qualityPage.cancel'], { ns: 'knowledgeQuality' })}
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </DialogPopup>
  )
}
