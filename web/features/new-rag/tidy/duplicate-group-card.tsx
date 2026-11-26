'use client'

import type { CardProps, Evidence } from './card-parts'
import type { DuplicateGroup } from './review'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checklist, DocumentTile, FindingShell, MatchMeter } from './card-parts'
import { mergePlan, newestDocument, relativeTime } from './review'

export function DuplicateGroupCard({
  busy,
  canManage,
  cards,
  complete,
  group,
  onConfirm,
  onRun,
  spaceId,
}: CardProps & {
  /**
   * Whether the group was built from every open duplicate finding. If not, copies may be missing
   * from it, so neither a newest copy nor a keep-one merge is offered.
   */
  complete: boolean
  group: DuplicateGroup
}) {
  const { t, i18n } = useTranslation(['knowledgeSpace'])
  const newest = newestDocument(group.documentIds, cards)
  const [chosen, setChosen] = useState(newest)
  // The group is rebuilt on every refresh: a copy handled elsewhere leaves it, and a choice that
  // left with it must not survive as a plan that keeps (and so disables) nothing.
  const keep = group.documentIds.includes(chosen) ? chosen : newest
  const evidenceOf = (id: string) =>
    group.findings
      .flatMap((finding) => [finding.left, finding.right])
      .find((evidence) => evidence.documentId === id) as Evidence
  const titleOf = (id: string) => cards[id]?.title ?? evidenceOf(id).title
  const stale = group.findings.some((finding) => finding.stale)
  const editable = canManage && !stale
  const mergeable = editable && complete
  const dismissAll = () => onRun(group.findings.map((finding) => ({ finding, action: 'dismiss' })))
  return (
    <FindingShell
      kind="duplicate"
      title={t(($) => $['tidy.copiesTitle'], {
        count: group.documentIds.length,
        title: titleOf(newest),
      })}
      meter={<MatchMeter value={1} label={t(($) => $['tidy.identical'])} />}
      stale={stale}
      onDismiss={editable ? dismissAll : undefined}
      aside={
        <>
          <p className="body-sm-regular text-text-secondary">
            {t(($) => $['tidy.copiesExplain'], { count: group.documentIds.length })}
          </p>
          {complete && (
            <Checklist
              items={[
                t(($) => $['tidy.newestIs'], {
                  title: titleOf(newest),
                  time: relativeTime(cards[newest]?.publishedAt, i18n.language),
                }),
              ]}
            />
          )}
          {editable && (
            <div className="mt-auto flex flex-col gap-2 pt-1">
              {mergeable && (
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={busy}
                  onClick={() =>
                    onConfirm({
                      title: t(($) => $['tidy.mergeTitle'], { title: titleOf(keep) }),
                      description: t(($) => $['tidy.mergeDescription']),
                      plan: mergePlan(group, keep),
                    })
                  }
                >
                  <span aria-hidden className="i-ri-check-line size-4" />
                  {keep === newest
                    ? t(($) => $['tidy.keepNewestMerge'])
                    : t(($) => $['tidy.keepSelectedMerge'])}
                </Button>
              )}
              <Button className="w-full" disabled={busy} onClick={dismissAll}>
                {t(($) => $['tidy.keepAll'])}
              </Button>
            </div>
          )}
        </>
      }
    >
      <div
        role={mergeable ? 'radiogroup' : undefined}
        aria-label={mergeable ? t(($) => $['tidy.chooseKeep']) : undefined}
        className="flex flex-wrap gap-3"
      >
        {group.documentIds.map((id) => (
          <DocumentTile
            key={id}
            card={cards[id]}
            evidence={evidenceOf(id)}
            spaceId={spaceId}
            latest={complete && id === newest}
            title={titleOf(id)}
            selected={mergeable && id === keep}
            onSelect={mergeable ? () => setChosen(id) : undefined}
            note={
              mergeable && id === keep
                ? t(($) => $['tidy.keepThis'])
                : t(($) => $['tidy.exactCopy'])
            }
          />
        ))}
      </div>
    </FindingShell>
  )
}
