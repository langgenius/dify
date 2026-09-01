'use client'

import type { KnowledgeFsOverviewAttentionResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import {
  newKnowledgeDetailPath,
  newKnowledgeDocumentsPath,
  newKnowledgeRetrievalTestPath,
  newKnowledgeSettingsPath,
} from '../routes'
import { EmptyInline, OverviewErrorInline, Panel, Skeleton } from './overview-panel'
import {
  overviewAttentionDataAtom,
  overviewAttentionErrorAtom,
  overviewAttentionPendingAtom,
  overviewKnowledgeSpaceIdAtom,
  overviewShowEmptyModulesAtom,
} from './state'

const ATTENTION_PAGE_SIZE = 4

function attentionPresentation(
  issue: KnowledgeFsOverviewAttentionResponse,
  t: ReturnType<typeof useTranslation<'dataset'>>['t'],
): { description?: string; title: string } {
  const evidenceCodes = new Set(issue.evidence.map(({ code }) => code))
  if (issue.rule_id === 'stale-source')
    return {
      description: t(($) => $['newKnowledge.overview.attention.staleSource.description']),
      title: t(($) => $['newKnowledge.overview.attention.staleSource.title']),
    }
  if (issue.rule_id === 'failed-document')
    return {
      description: t(($) => $['newKnowledge.overview.attention.failedDocument.description']),
      title: t(($) => $['newKnowledge.overview.attention.failedDocument.title']),
    }
  if (issue.rule_id === 'low-quality-query')
    return {
      description: t(($) => $['newKnowledge.overview.attention.lowQualityQuery.description']),
      title: t(($) => $['newKnowledge.overview.attention.lowQualityQuery.title']),
    }
  if (issue.rule_id === 'model-readiness') {
    const reasons: string[] = []
    if (
      evidenceCodes.has('MODEL_EMBEDDING_PROFILE_MISSING') ||
      evidenceCodes.has('MODEL_RETRIEVAL_PROFILE_MISSING')
    )
      reasons.push(t(($) => $['newKnowledge.overview.attention.modelReadiness.profilesMissing']))
    if (evidenceCodes.has('MODEL_PUBLICATION_BINDING_MISSING'))
      reasons.push(t(($) => $['newKnowledge.overview.attention.modelReadiness.bindingMissing']))
    return {
      description:
        reasons.join(' ') ||
        t(($) => $['newKnowledge.overview.attention.modelReadiness.description']),
      title: t(($) => $['newKnowledge.overview.attention.modelReadiness.title']),
    }
  }

  return { title: issue.title }
}

export function AttentionPanel() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const attention = useAtomValue(overviewAttentionDataAtom)
  const empty = useAtomValue(overviewShowEmptyModulesAtom)
  const error = useAtomValue(overviewAttentionErrorAtom)
  const knowledgeSpaceId = useAtomValue(overviewKnowledgeSpaceIdAtom)
  const loading = useAtomValue(overviewAttentionPendingAtom)
  const [issuePage, setIssuePage] = useState(0)
  // Dify owns product authorization; ignore responses cached or served by an older backend that
  // still contain the retired KnowledgeFS-local permission readiness rule.
  const actionableAttention = attention.filter((issue) => issue.rule_id !== 'permission-readiness')
  const issuePageCount = Math.max(1, Math.ceil(actionableAttention.length / ATTENTION_PAGE_SIZE))
  const activeIssuePage = Math.min(issuePage, issuePageCount - 1)
  const visibleIssues = actionableAttention.slice(
    activeIssuePage * ATTENTION_PAGE_SIZE,
    activeIssuePage * ATTENTION_PAGE_SIZE + ATTENTION_PAGE_SIZE,
  )
  const issueAction = (issue: KnowledgeFsOverviewAttentionResponse) => {
    if (issue.action.kind === 'review-models')
      return {
        href: newKnowledgeSettingsPath(knowledgeSpaceId),
        label: t(($) => $['newKnowledge.overview.attention.action.configureModels']),
      }
    if (issue.action.resource_type === 'failed-query' || issue.rule_id === 'low-quality-query')
      return {
        href: newKnowledgeRetrievalTestPath(knowledgeSpaceId),
        label: t(($) => $['newKnowledge.overview.reviewConflict']),
      }
    if (issue.action.resource_type === 'source')
      return {
        href: newKnowledgeDetailPath(knowledgeSpaceId),
        label: t(($) => $['newKnowledge.overview.fixSource']),
      }
    return {
      href: newKnowledgeDocumentsPath(knowledgeSpaceId),
      label: t(($) => $['newKnowledge.overview.viewDocuments']),
    }
  }

  if (error)
    return (
      <section className="flex h-66.75 min-w-0 flex-col gap-2 pt-6">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.needsAttention'])}
        </h2>
        <Panel className="flex h-52.75 border border-components-panel-border p-4 shadow-none">
          <OverviewErrorInline />
        </Panel>
      </section>
    )

  if (empty)
    return (
      <section className="flex h-66.75 min-w-0 flex-col gap-2 pt-6">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.needsAttention'])}
        </h2>
        <Panel className="flex h-52.75 border border-components-panel-border p-4 shadow-none">
          <EmptyInline
            positive
            icon="i-ri-thumb-up-line"
            title={t(($) => $['newKnowledge.overview.noIssues'])}
            description={t(($) => $['newKnowledge.overview.noIssuesDescription'])}
          />
        </Panel>
      </section>
    )

  return (
    <section className="flex h-93.25 min-w-0 flex-col gap-2 pt-6">
      <div className="flex h-6 items-center">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.needsAttention'])}
        </h2>
      </div>
      <Panel className="flex h-79.25 flex-col overflow-hidden border border-divider-subtle px-4 pt-3 pb-1 shadow-none">
        {loading ? (
          <div>
            {[
              ['attention-1', 100],
              ['attention-2', 100],
              ['attention-3', 100],
              ['attention-4', 100],
            ].map(([key, width]) => (
              <div key={key} className="flex h-16 items-center">
                <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        ) : actionableAttention.length ? (
          <>
            <ul className="min-h-0 flex-1 overflow-hidden">
              {visibleIssues.map((issue) => {
                const presentation = attentionPresentation(issue, t)
                const action = issueAction(issue)
                return (
                  <li key={issue.issue_key} className="flex h-16 min-w-0 items-center gap-4">
                    <span
                      className={cn(
                        'shrink-0 rounded-md px-2 py-0.5 system-xs-medium',
                        issue.severity === 'critical'
                          ? 'bg-state-destructive-hover text-text-destructive'
                          : issue.severity === 'warning'
                            ? 'bg-state-warning-hover text-text-warning'
                            : 'bg-background-section text-text-tertiary',
                      )}
                    >
                      {issue.severity === 'critical'
                        ? t(($) => $['newKnowledge.overview.blocker'])
                        : issue.severity === 'warning'
                          ? t(($) => $['newKnowledge.overview.serious'])
                          : t(($) => $['newKnowledge.overview.review'])}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate system-sm-medium text-text-primary">
                        {presentation.title}
                      </p>
                      {presentation.description && (
                        <p className="mt-0.5 line-clamp-2 body-xs-regular text-text-tertiary">
                          {presentation.description}
                        </p>
                      )}
                    </div>
                    <Button
                      render={<Link href={action.href} />}
                      nativeButton={false}
                      size="small"
                      tone={issue.severity === 'critical' ? 'destructive' : 'default'}
                      variant={issue.severity === 'critical' ? 'primary' : 'secondary'}
                      className={cn(
                        issue.severity === 'critical' &&
                          'border-[#ff4d14] bg-[#ff4d14] hover:border-[#e64210] hover:bg-[#e64210]',
                      )}
                    >
                      {action.label}
                    </Button>
                  </li>
                )
              })}
            </ul>
            <div className="flex h-11 shrink-0 items-end justify-end border-t border-divider-subtle pb-1">
              <div className="flex h-8 items-center rounded-lg border border-divider-subtle p-0.5">
                <button
                  type="button"
                  aria-label={tCommon(($) => $['pagination.previous'])}
                  className="flex size-7 items-center justify-center rounded-md text-text-quaternary"
                  disabled={activeIssuePage === 0}
                  onClick={() => setIssuePage(Math.max(0, activeIssuePage - 1))}
                >
                  <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
                </button>
                <span className="px-2 system-xs-medium text-text-secondary">
                  {activeIssuePage + 1} / {issuePageCount}
                </span>
                <button
                  type="button"
                  aria-label={tCommon(($) => $['pagination.next'])}
                  className="flex size-7 items-center justify-center rounded-md text-text-quaternary"
                  disabled={activeIssuePage >= issuePageCount - 1}
                  onClick={() => setIssuePage(Math.min(issuePageCount - 1, activeIssuePage + 1))}
                >
                  <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyInline
            icon="i-ri-checkbox-circle-line"
            title={t(($) => $['newKnowledge.overview.noIssues'])}
            description={t(($) => $['newKnowledge.overview.noIssuesDescription'])}
          />
        )}
      </Panel>
    </section>
  )
}
