'use client'

import type { CardProps, Finding } from './card-parts'
import type { PairGroup } from './review'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { Checklist, DocumentHeading, FindingShell, MatchMeter, Passage } from './card-parts'
import { disablePlan, evidenceOf, newestDocument, relativeTime } from './review'

/**
 * Everything two documents disagree on, in one card. Each difference is settled on its own (the
 * source was corrected, or both statements hold); taking a whole document out of retrieval is the
 * exception, offered apart from the per-difference choices.
 */
export function PairGroupCard({
  busy,
  canManage,
  cards,
  complete,
  group,
  onConfirm,
  onRewrite,
  onRun,
  spaceId,
}: CardProps & {
  /**
   * Whether the group was built from every open finding of its kinds. If not, the pair may have
   * findings the group lacks, so disabling a document on the group's behalf is not offered.
   */
  complete: boolean
  group: PairGroup
}) {
  const { t, i18n } = useTranslation(['knowledgeSpace'])
  const first = group.findings[0] as Finding
  const titleOf = (id: string) => cards[id]?.title ?? evidenceOf(first, id).title
  const [leftId, rightId] = group.documentIds
  const otherOf = (id: string) => (id === leftId ? rightId : leftId)
  const newest = newestDocument(group.documentIds, cards)
  const stale = group.findings.some((finding) => finding.stale)
  const editable = canManage && !stale
  const semantic = group.similar?.reason === 'semantic_overlap'
  // Documents that disagree are not identical, however much of their text matches.
  const percent = Math.min(semantic ? 100 : 99, Math.round((group.similar?.similarity ?? 0) * 100))
  const overlapLabel = semantic
    ? t(($) => $['tidy.semanticCoverage'], { percent })
    : t(($) => $['tidy.overlap'], { percent })
  const disable = (documentId: string) => {
    const plan = disablePlan(group, documentId)
    onConfirm({
      title: t(($) => $['tidy.disableOne'], { title: titleOf(documentId) }),
      description:
        plan.length > 1
          ? `${t(($) => $['tidy.disableNotice'])} ${t(($) => $['tidy.disableAlsoResolves'], { count: plan.length - 1 })}`
          : t(($) => $['tidy.disableNotice']),
      plan,
    })
  }
  return (
    <FindingShell
      kind="conflict"
      title={t(($) => $['tidy.pairConflictTitle'], {
        count: group.conflicts.length,
        left: titleOf(leftId),
        right: titleOf(rightId),
      })}
      meter={
        group.similar ? (
          <MatchMeter value={group.similar.similarity ?? 0} label={overlapLabel} />
        ) : undefined
      }
      stale={stale}
      onDismiss={
        editable
          ? () => onRun(group.findings.map((finding) => ({ finding, action: 'dismiss' })))
          : undefined
      }
      aside={
        <>
          <p className="body-sm-regular text-text-secondary">
            {t(($) => $['tidy.conflictExplain'])}
          </p>
          <Checklist
            items={[
              t(($) => $['tidy.newestIs'], {
                title: titleOf(newest),
                time: relativeTime(cards[newest]?.publishedAt, i18n.language),
              }),
              ...(group.similar ? [t(($) => $['tidy.pairAlsoSimilar'], { percent })] : []),
            ]}
          />
          {editable && complete && (
            <div className="mt-auto flex flex-col gap-2 border-t border-divider-subtle pt-3">
              <p className="system-xs-medium text-text-tertiary">
                {t(($) => $['tidy.wholeOutdated'])}
              </p>
              {group.documentIds.map((id) => (
                <Button
                  key={id}
                  size="small"
                  className="w-full"
                  disabled={busy}
                  onClick={() => disable(id)}
                >
                  <span aria-hidden className="i-ri-forbid-line size-3.5" />
                  <span className="truncate">
                    {t(($) => $['tidy.disableOne'], { title: titleOf(id) })}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="hidden gap-3 md:grid md:grid-cols-2">
          {group.documentIds.map((id) => (
            <DocumentHeading
              key={id}
              card={cards[id]}
              evidence={evidenceOf(first, id)}
              spaceId={spaceId}
              title={titleOf(id)}
            />
          ))}
        </div>
        <ol className="flex flex-col gap-4">
          {group.conflicts.map((finding) => (
            <li
              key={finding.id}
              aria-label={finding.reason}
              className="flex flex-col gap-2 border-t border-divider-subtle pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <h4 className="min-w-0 flex-1 system-sm-semibold wrap-break-word text-text-primary">
                  {finding.reason}
                </h4>
                {editable && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => onRun([{ finding, action: 'review' }])}
                    >
                      {t(($) => $['tidy.markHandled'])}
                    </Button>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => onRun([{ finding, action: 'dismiss' }])}
                    >
                      {t(($) => $['tidy.notConflict'])}
                    </Button>
                  </div>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {group.documentIds.map((id) => (
                  <div key={id} className="flex min-w-0 flex-col gap-2">
                    {/* Side by side the column headings above name the documents; stacked, each passage does. */}
                    <div className="md:hidden">
                      <DocumentHeading
                        card={cards[id]}
                        evidence={evidenceOf(finding, id)}
                        spaceId={spaceId}
                        title={titleOf(id)}
                      />
                    </div>
                    <Passage evidence={evidenceOf(finding, id)} />
                    {editable && (
                      <Button
                        size="small"
                        variant="primary"
                        className="self-start"
                        // The statement is kept; the passage in the other document is rewritten.
                        disabled={busy}
                        onClick={() =>
                          onRewrite({
                            finding,
                            keptDocumentId: id,
                            keptTitle: titleOf(id),
                            targetTitle: titleOf(otherOf(id)),
                            passage: evidenceOf(finding, otherOf(id)).text,
                            replacement: evidenceOf(finding, id).text,
                          })
                        }
                      >
                        <span aria-hidden className="i-ri-check-line size-3.5" />
                        {t(($) => $['tidy.adopt'])}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </FindingShell>
  )
}
