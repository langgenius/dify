'use client'

import type { CardProps, Evidence, Finding } from './card-parts'
import type { PlannedAction } from './review'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Checklist,
  DocumentHeading,
  DocumentTile,
  FindingShell,
  MatchMeter,
  Passage,
  StatusAside,
} from './card-parts'
import { newestDocument, relativeTime } from './review'

export function PairCard({
  busy,
  canManage,
  cards,
  finding,
  onConfirm,
  onRun,
  related = [],
  spaceId,
}: CardProps & {
  finding: Finding
  /**
   * Open conflicts between the same two documents: disabling one settles them too. Pass them
   * only when they are known to be all of the pair's open conflicts in the list.
   */
  related?: readonly Finding[]
}) {
  const { t, i18n } = useTranslation(['knowledgeSpace'])
  const sides = [finding.left, finding.right]
  const newest = newestDocument(
    sides.map((evidence) => evidence.documentId),
    cards,
  )
  const [keep, setKeep] = useState(newest)
  const open = finding.status === 'open'
  const editable = canManage && open && !finding.stale
  const titleOf = (evidence: Evidence) => cards[evidence.documentId]?.title ?? evidence.title
  const semantic = finding.reason === 'semantic_overlap'
  // Only identical content is 100%: a rounded-up figure would read as "safe to drop one".
  const percent = Math.min(
    finding.kind === 'duplicate' || semantic ? 100 : 99,
    Math.round((finding.similarity ?? 0) * 100),
  )
  const disable = (evidence: Evidence, kept?: Evidence) =>
    onConfirm({
      title: kept
        ? t(($) => $['tidy.mergeTitle'], { title: titleOf(kept) })
        : t(($) => $['tidy.disableOne'], { title: titleOf(evidence) }),
      description: [
        kept ? t(($) => $['tidy.mergeDescription']) : t(($) => $['tidy.disableNotice']),
        ...(related.length
          ? [t(($) => $['tidy.disableAlsoResolves'], { count: related.length })]
          : []),
      ].join(' '),
      plan: [
        { finding, action: 'disable_document', documentId: evidence.documentId },
        ...related.map((other): PlannedAction => ({ finding: other, action: 'review' })),
      ],
    })
  const dismiss = () => onRun([{ finding, action: 'dismiss' }])
  const review = (
    <Button
      className="w-full"
      disabled={busy}
      onClick={() => onRun([{ finding, action: 'review' }])}
    >
      <span aria-hidden className="i-ri-check-line size-4" />
      {finding.kind === 'similar' ? t(($) => $['tidy.keepBoth']) : t(($) => $['tidy.review'])}
    </Button>
  )

  // Open conflicts are reviewed per document pair (PairGroupCard); this is their handled state.
  if (finding.kind === 'conflict') {
    return (
      <FindingShell
        kind="conflict"
        title={finding.reason}
        stale={finding.stale}
        aside={<StatusAside busy={busy} canManage={canManage} finding={finding} onRun={onRun} />}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {sides.map((evidence) => (
            <div key={evidence.documentId} className="flex min-w-0 flex-col gap-2">
              <DocumentHeading
                card={cards[evidence.documentId]}
                evidence={evidence}
                spaceId={spaceId}
                title={titleOf(evidence)}
              />
              <Passage evidence={evidence} />
            </div>
          ))}
        </div>
      </FindingShell>
    )
  }

  const kept = sides.find((evidence) => evidence.documentId === keep) ?? finding.left
  const other = sides.find((evidence) => evidence.documentId !== keep) ?? finding.right
  const isDuplicate = finding.kind === 'duplicate'
  return (
    <FindingShell
      kind={finding.kind}
      title={
        isDuplicate
          ? t(($) => $['tidy.copiesTitle'], { count: 2, title: titleOf(finding.left) })
          : t(($) => $['tidy.similarTitle'], {
              left: titleOf(finding.left),
              right: titleOf(finding.right),
            })
      }
      meter={
        <MatchMeter
          value={isDuplicate ? 1 : (finding.similarity ?? 0)}
          label={
            isDuplicate
              ? t(($) => $['tidy.identical'])
              : semantic
                ? t(($) => $['tidy.semanticCoverage'], { percent })
                : t(($) => $['tidy.overlap'], { percent })
          }
        />
      }
      stale={finding.stale}
      onDismiss={editable ? dismiss : undefined}
      aside={
        open ? (
          <>
            <p className="body-sm-regular text-text-secondary">
              {isDuplicate
                ? t(($) => $['tidy.copiesExplain'], { count: 2 })
                : semantic
                  ? t(($) => $['tidy.semanticReason'])
                  : t(($) => $['tidy.similarReason'])}
            </p>
            <Checklist
              items={[
                t(($) => $['tidy.newestIs'], {
                  title: titleOf(
                    sides.find((evidence) => evidence.documentId === newest) ?? finding.left,
                  ),
                  time: relativeTime(cards[newest]?.publishedAt, i18n.language),
                }),
                ...(related.length
                  ? [t(($) => $['tidy.pairHasConflicts'], { count: related.length })]
                  : []),
              ]}
            />
            {editable && (
              <div className="mt-auto flex flex-col gap-2 pt-1">
                {isDuplicate ? (
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={busy}
                    onClick={() => disable(other, kept)}
                  >
                    <span aria-hidden className="i-ri-check-line size-4" />
                    {t(($) => $['tidy.keepSelectedDisableOther'])}
                  </Button>
                ) : (
                  review
                )}
                {isDuplicate ? (
                  review
                ) : (
                  // Overlapping documents usually both hold something unique: keeping both is as
                  // likely the right call as dropping one, so neither is the highlighted default.
                  <Button className="w-full" disabled={busy} onClick={() => disable(other, kept)}>
                    <span aria-hidden className="i-ri-forbid-line size-3.5" />
                    {t(($) => $['tidy.keepSelectedDisableOther'])}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <StatusAside busy={busy} canManage={canManage} finding={finding} onRun={onRun} />
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div
          role={editable ? 'radiogroup' : undefined}
          aria-label={editable ? t(($) => $['tidy.chooseKeep']) : undefined}
          className="flex flex-wrap gap-3"
        >
          {sides.map((evidence) => (
            <DocumentTile
              key={evidence.documentId}
              card={cards[evidence.documentId]}
              evidence={evidence}
              spaceId={spaceId}
              latest={evidence.documentId === newest}
              title={titleOf(evidence)}
              selected={editable && evidence.documentId === keep}
              onSelect={editable ? () => setKeep(evidence.documentId) : undefined}
              note={
                !editable
                  ? `v${evidence.revision}`
                  : evidence.documentId === keep
                    ? t(($) => $['tidy.keepThis'])
                    : t(($) => $['tidy.willDisable'])
              }
            />
          ))}
        </div>
        {!isDuplicate && (
          <div className="grid gap-3 md:grid-cols-2">
            {sides.map((evidence) => (
              <Passage key={evidence.documentId} evidence={evidence} />
            ))}
          </div>
        )}
      </div>
    </FindingShell>
  )
}
