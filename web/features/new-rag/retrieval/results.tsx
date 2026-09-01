'use client'

import type { AnchorHTMLAttributes, PropsWithChildren } from 'react'
import type { RetrievalEvidence } from './model'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { Link as MarkdownLink } from '@/app/components/base/markdown-blocks'
import DocumentFileIcon from '@/app/components/datasets/common/document-file-icon'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { newKnowledgeDocumentDetailPath } from '../routes'
import { retrievalKnowledgeSpaceIdAtom } from './state/inputs'

export type QualityDecision = 'bad-case' | 'golden'
export type BadCaseReason = 'low-score' | 'retrieval-miss'

function ScorePill({ score }: { score: number }) {
  const { t } = useTranslation('dataset')
  const normalized = Math.max(0, Math.min(1, score))
  const displayedScore = normalized > 0 && normalized < 0.01 ? '<0.01' : normalized.toFixed(2)
  return (
    <span className="relative inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.75 overflow-hidden rounded-md border border-components-progress-bar-border bg-util-colors-blue-brand-blue-brand-50 px-1.25 text-util-colors-blue-brand-blue-brand-700">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 border-r-[1.5px] border-components-progress-bar-progress-highlight bg-util-colors-blue-brand-blue-brand-100"
        style={{ width: `${normalized * 100}%` }}
      />
      <span className="relative system-2xs-medium">
        {t(($) => $['newKnowledge.retrievalTest.score'])}
      </span>
      <span className="relative system-xs-semibold">{displayedScore}</span>
    </span>
  )
}

async function resolveLogicalDocumentId({
  documentAssetId,
  documentName,
  knowledgeSpaceId,
}: {
  documentAssetId: string
  documentName?: string
  knowledgeSpaceId: string
}) {
  const matchingDocumentIds = new Set<string>()
  const visitedCursors = new Set<string>()
  let cursor: string | undefined

  while (true) {
    const page = await consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get({
      params: { control_space_id: knowledgeSpaceId },
      query: cursor ? { cursor } : {},
    })

    for (const document of page.data) {
      if (document.active?.document_asset_id === documentAssetId) return document.id
      if (documentName && document.title === documentName) matchingDocumentIds.add(document.id)
    }

    const nextCursor = page.next_cursor ?? undefined
    if (!nextCursor || visitedCursors.has(nextCursor)) break
    visitedCursors.add(nextCursor)
    cursor = nextCursor
  }

  return matchingDocumentIds.size === 1 ? [...matchingDocumentIds][0] : undefined
}

function EvidenceOpenAction({ evidence }: { evidence: RetrievalEvidence }) {
  const { t } = useTranslation('dataset')
  const router = useRouter()
  const knowledgeSpaceId = useAtomValue(retrievalKnowledgeSpaceIdAtom)
  const [isResolving, setIsResolving] = useState(false)
  if (evidence.availability === 'unavailable') return null
  const actionClassName =
    'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-wait disabled:opacity-60'
  const openHref = evidence.documentId
    ? newKnowledgeDocumentDetailPath(knowledgeSpaceId, evidence.documentId, {
        chunkId: evidence.chunkId,
        revision: evidence.documentRevision,
      })
    : undefined

  if (openHref) {
    return (
      <Link href={openHref} className={actionClassName}>
        {t(($) => $['newKnowledge.retrievalTest.open'])}
        <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
      </Link>
    )
  }

  const documentAssetId = evidence.documentAssetId
  if (!documentAssetId) return null

  const handleOpen = async () => {
    setIsResolving(true)
    try {
      const documentId = await resolveLogicalDocumentId({
        documentAssetId,
        documentName: evidence.documentName,
        knowledgeSpaceId,
      })
      if (!documentId) {
        toast.error(t(($) => $['newKnowledge.documentNotFoundDescription']))
        return
      }
      router.push(
        newKnowledgeDocumentDetailPath(knowledgeSpaceId, documentId, {
          chunkId: evidence.chunkId,
          revision: evidence.documentRevision,
        }),
      )
    } catch {
      toast.error(t(($) => $['newKnowledge.documentLoadErrorDescription']))
    } finally {
      setIsResolving(false)
    }
  }

  return (
    <button
      type="button"
      className={actionClassName}
      disabled={isResolving}
      aria-busy={isResolving}
      onClick={handleOpen}
    >
      {t(($) => $['newKnowledge.retrievalTest.open'])}
      <span
        aria-hidden
        className={cn(
          'size-3.5',
          isResolving ? 'i-ri-loader-2-line animate-spin' : 'i-ri-arrow-right-up-line',
        )}
      />
    </button>
  )
}

export function EvidenceCard({
  citationTargetId,
  citationTargeted,
  evidence,
  index,
}: {
  citationTargetId?: string
  citationTargeted?: boolean
  evidence: RetrievalEvidence
  index: number
}) {
  const { t } = useTranslation('dataset')
  const unavailable = evidence.availability === 'unavailable'

  return (
    <article
      id={citationTargetId}
      tabIndex={citationTargetId ? -1 : undefined}
      className={cn(
        'overflow-hidden rounded-xl bg-components-panel-bg outline-hidden',
        citationTargeted && 'ring-2 ring-state-accent-solid ring-inset',
      )}
    >
      <div className="flex flex-col gap-1 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <h3 className="flex min-w-0 flex-1 items-center gap-0.5 truncate system-xs-medium text-text-tertiary">
            <span aria-hidden className="i-custom-public-knowledge-selection-mod size-3 shrink-0" />
            <span className="truncate">
              {unavailable
                ? `${t(($) => $['newKnowledge.qualityPage.evidence'])} ${index + 1} · ${t(($) => $['cornerLabel.unavailable'])}`
                : evidence.title || `Chunk ${index + 1}`}
            </span>
          </h3>
          {!unavailable && evidence.score !== undefined && <ScorePill score={evidence.score} />}
        </div>
        {unavailable ? (
          <div className="flex items-start gap-2 rounded-lg bg-state-base-hover px-3 py-2 text-text-tertiary">
            <span aria-hidden className="mt-0.5 i-ri-error-warning-line size-4 shrink-0" />
            <p className="body-sm-regular">
              {t(($) => $['newKnowledge.qualityPage.evaluation.evidenceUnavailable'])}
            </p>
          </div>
        ) : (
          <p className="body-md-regular tracking-[-0.07px] whitespace-pre-wrap text-text-secondary">
            {evidence.text}
          </p>
        )}
        {!unavailable && evidence.images.length > 0 && (
          <div className="flex gap-1 overflow-hidden py-1">
            {evidence.images.slice(0, 4).map((image) => (
              <span key={image} className="flex size-8 shrink-0 items-center justify-center p-0.5">
                <img
                  src={image}
                  alt=""
                  className="size-7.5 border-2 border-effects-image-frame object-cover shadow-xs"
                />
              </span>
            ))}
            {evidence.images.length > 4 && (
              <span className="flex h-8 shrink-0 items-center px-0.5 py-1">
                <span className="flex size-7 items-center justify-center rounded-sm border-[1.5px] border-components-panel-bg bg-divider-regular system-xs-regular text-text-tertiary">
                  +{evidence.images.length - 4}
                </span>
              </span>
            )}
          </div>
        )}
      </div>
      {!unavailable && (
        <footer className="flex h-10 items-center gap-1.5 border-t border-divider-subtle py-2 pr-2 pl-3">
          <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
            <DocumentFileIcon name={evidence.documentName ?? evidence.title} size="sm" />
          </span>
          <span className="min-w-0 truncate system-sm-regular text-text-secondary">
            {evidence.documentName ?? evidence.title}
          </span>
          {evidence.revision && (
            <span className="shrink-0 rounded-xs bg-divider-subtle px-1.25 py-px system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.retrievalTest.revision'], {
                revision: evidence.revision,
              })}
            </span>
          )}
          {evidence.page !== undefined && (
            <span className="shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.retrievalTest.page'], { page: evidence.page })}
            </span>
          )}
          <span className="min-w-0 flex-1" />
          <EvidenceOpenAction evidence={evidence} />
        </footer>
      )}
    </article>
  )
}

export function ResultSkeleton() {
  const { t } = useTranslation('common')

  return (
    <div role="status" aria-live="polite" aria-label={t(($) => $.loading)} className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className={cn(
            'flex animate-pulse flex-col gap-2.5 overflow-hidden rounded-xl bg-components-panel-bg px-3 py-3.5 motion-reduce:animate-none',
            item === 2 && 'opacity-60',
          )}
        >
          <div className="flex items-center justify-between overflow-hidden">
            <div className="h-3 w-30 shrink-0 rounded-xs bg-divider-regular" />
            <div className="h-4 w-14 shrink-0 rounded-md bg-divider-subtle" />
          </div>
          <div className="h-3 w-full shrink-0 rounded-xs bg-divider-subtle" />
          <div className="h-3 w-110 max-w-full shrink-0 rounded-xs bg-divider-subtle" />
          <div className="h-px w-full shrink-0 bg-divider-subtle" />
          <div className="flex items-start justify-between overflow-hidden">
            <div className="h-3 w-50 shrink-0 rounded-xs bg-divider-subtle" />
            <div className="h-3 w-10 shrink-0 rounded-xs bg-divider-subtle" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  description,
  kind = 'initial',
  title,
}: {
  description: string
  kind?: 'initial' | 'no-results'
  title: string
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
      <span
        aria-hidden
        className={cn(
          kind === 'initial'
            ? 'i-custom-vender-main-nav-quick-search size-6 text-text-tertiary'
            : 'i-ri-alert-fill size-5 text-text-warning',
        )}
      />
      <h2 className="mt-1.5 system-md-medium text-text-primary">{title}</h2>
      <p className="mt-1.5 max-w-97.25 system-xs-regular text-text-tertiary">{description}</p>
    </div>
  )
}

export function FailedResult({
  description,
  onRetry,
}: {
  description: string
  onRetry: () => void
}) {
  const { t } = useTranslation('dataset')
  return (
    <div
      role="alert"
      className="flex min-h-10 items-center gap-1.5 rounded-[10px] bg-util-colors-red-red-500/5 px-3 py-2"
    >
      <span aria-hidden className="i-ri-alert-fill size-3.5 text-text-destructive" />
      <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
        {t(($) => $['newKnowledge.retrievalTest.failedTitle'])}
        {' — '}
        <span>{description}</span>
      </span>
      <Button size="small" variant="secondary" onClick={onRetry}>
        {t(($) => $['newKnowledge.retrievalTest.retry'])}
      </Button>
    </div>
  )
}

const researchCitationPattern = /(?<!\\)\[(\d+)\](?!\s*(?:\(|:))/g
const researchCodePattern = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*(?:`|$))/g

function linkResearchCitations(answer: string, citationCount: number) {
  return answer
    .split(researchCodePattern)
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      return segment.replace(researchCitationPattern, (citation, rawCitationNumber: string) => {
        const citationNumber = Number(rawCitationNumber)
        if (citationNumber < 1 || citationNumber > citationCount) return citation
        return `[${citation}](#research-evidence-${citationNumber})`
      })
    })
    .join('')
}

type ResearchAnswerLinkProps = PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement>> & {
  node?: unknown
  onCitationClick: (citationIndex: number) => void
}

function ResearchAnswerLink({
  children,
  href,
  node,
  onCitationClick,
  ...props
}: ResearchAnswerLinkProps) {
  const citationMatch = href?.match(/^#research-evidence-(\d+)$/)
  if (!citationMatch)
    return (
      <MarkdownLink {...props} href={href} node={node}>
        {children}
      </MarkdownLink>
    )

  const citationIndex = Number(citationMatch[1]) - 1
  return (
    <a
      {...props}
      href={href}
      className="rounded-sm px-0.5 font-medium text-text-accent outline-hidden hover:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      onClick={(event) => {
        event.preventDefault()
        onCitationClick(citationIndex)
      }}
    >
      {children}
    </a>
  )
}

export function ResearchAnswer({
  answer,
  citationCount,
  onCitationClick,
  streaming,
}: {
  answer: string
  citationCount: number
  onCitationClick: (citationIndex: number) => void
  streaming: boolean
}) {
  const { t } = useTranslation('dataset')
  const linkedAnswer = useMemo(
    () => linkResearchCitations(answer, citationCount),
    [answer, citationCount],
  )
  const citationComponents = useMemo<NonNullable<MarkdownProps['customComponents']>>(
    () => ({
      a: (props) => <ResearchAnswerLink {...props} onCitationClick={onCitationClick} />,
    }),
    [onCitationClick],
  )
  return (
    <section className="mt-3 rounded-xl border border-components-panel-border bg-components-panel-bg px-4 py-3.5 shadow-xs">
      <header className="mb-3 flex items-center gap-2">
        <span aria-hidden className="i-ri-sparkling-2-fill size-4 text-text-accent" />
        <h3 className="system-sm-semibold text-text-primary">
          {t(($) =>
            streaming
              ? $['newKnowledge.retrievalTest.generatingActive']
              : $['newKnowledge.retrievalTest.generating'],
          )}
        </h3>
        {streaming && (
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-text-accent motion-reduce:animate-none"
          />
        )}
      </header>
      <div aria-live="polite" aria-atomic="false">
        <Markdown
          className="text-[13px]! leading-5.5! wrap-break-word text-text-secondary!"
          content={linkedAnswer}
          customComponents={citationComponents}
          isAnimating={streaming}
          mode={streaming ? 'streaming' : undefined}
        />
      </div>
    </section>
  )
}

export function QualityActions({
  badCaseAvailable,
  decision,
  noResults,
  onBadCase,
  onGolden,
  pending,
  qualityHref,
}: {
  badCaseAvailable: boolean
  decision?: QualityDecision
  noResults?: boolean
  onBadCase: (reason: BadCaseReason) => Promise<void>
  onGolden: () => void
  pending?: boolean
  qualityHref: string
}) {
  const { t } = useTranslation('dataset')
  if (decision) {
    return (
      <div
        aria-live="polite"
        className="flex min-h-14 items-center justify-between gap-3 border-t border-divider-subtle px-5"
      >
        <span className="flex items-center gap-2 system-sm-medium text-text-success">
          <span aria-hidden className="i-ri-checkbox-circle-fill size-4" />
          {t(($) =>
            decision === 'golden'
              ? $['newKnowledge.retrievalTest.savedGoldenQuestion']
              : $['newKnowledge.retrievalTest.savedBadCase'],
          )}
        </span>
        <Link
          href={qualityHref}
          className="rounded-md px-1 py-0.5 system-sm-semibold text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          {t(($) => $['newKnowledge.retrievalTest.viewInQuality'])}
        </Link>
      </div>
    )
  }
  if (!badCaseAvailable && noResults) return null

  return (
    <div className="flex shrink-0 items-center justify-end gap-3 border-t border-divider-regular pt-4 pb-1">
      {badCaseAvailable && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={pending}
            render={<Button loading={pending} variant={noResults ? 'secondary' : 'ghost'} />}
          >
            <span aria-hidden className="i-ri-thumb-down-line size-4" />
            {t(($) => $['newKnowledge.retrievalTest.makeBadCase'])}
          </DropdownMenuTrigger>
          <DropdownMenuContent placement="top-end" sideOffset={4} className="w-44">
            <DropdownMenuItem onClick={() => void onBadCase('low-score')}>
              {t(($) => $['newKnowledge.qualityPage.reasonValues.lowScore'])}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void onBadCase('retrieval-miss')}>
              {t(($) => $['newKnowledge.qualityPage.reasonValues.retrievalMiss'])}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {!noResults && (
        <Button
          disabled={pending}
          loading={pending}
          variant="secondary"
          onClick={() => void onGolden()}
        >
          <span aria-hidden className="i-ri-thumb-up-line size-4" />
          {t(($) => $['newKnowledge.retrievalTest.keepGoldenQuestion'])}
        </Button>
      )}
    </div>
  )
}
