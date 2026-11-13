'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { getDuplicateNodeTitles } from './duplicate-node-titles'

type EvaluationNodeNameNoticeProps = {
  resourceType: 'apps' | 'snippets'
  resourceId: string
  children: ReactNode
}

type Notice = { kind: 'duplicate'; names: string[] } | { kind: 'error' }

/** Warn about published node names while keeping Evaluation available. */
const EvaluationNodeNameNotice = ({
  resourceType,
  resourceId,
  children,
}: EvaluationNodeNameNoticeProps) => {
  const { t } = useTranslation(['evaluation', 'common'])
  const [dismissedNoticeKey, setDismissedNoticeKey] = useState<string | null>(null)
  const nodesQuery = useQuery(
    consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.nodeInfo.post.queryOptions({
      input: {
        params: { evaluate_target_type: resourceType, evaluate_target_id: resourceId },
        body: { metrics: [] },
      },
      refetchOnMount: 'always',
      retry: false,
    }),
  )
  const metricNodes = nodesQuery.data?.all
  const duplicateNames = metricNodes ? getDuplicateNodeTitles(metricNodes) : []
  const notice: Notice | null = !nodesQuery.isFetchedAfterMount
    ? null
    : nodesQuery.isError || !metricNodes
      ? { kind: 'error' }
      : duplicateNames.length > 0
        ? { kind: 'duplicate', names: duplicateNames }
        : null
  const noticeKey =
    notice?.kind === 'duplicate'
      ? `duplicate:${JSON.stringify(notice.names)}`
      : notice?.kind === 'error'
        ? `error:${nodesQuery.errorUpdatedAt}`
        : null

  return (
    <>
      {children}
      <Dialog
        open={noticeKey !== null && noticeKey !== dismissedNoticeKey}
        onOpenChange={(open) => !open && setDismissedNoticeKey(noticeKey)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {notice?.kind === 'duplicate'
                ? t(($) => $['entry.duplicateNodeNamesTitle'])
                : t(($) => $['errorBoundary.title'], { ns: 'common' })}
            </DialogTitle>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              {notice?.kind === 'duplicate'
                ? t(($) => $['entry.duplicateNodeNames'], { names: notice.names.join(', ') })
                : t(($) => $['entry.checkFailed'])}
            </DialogDescription>
          </DialogBody>
          <DialogFooter>
            {notice?.kind === 'error' && (
              <Button
                variant="secondary"
                disabled={nodesQuery.isFetching}
                onClick={() => void nodesQuery.refetch()}
              >
                {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
              </Button>
            )}
            <DialogClose render={<Button variant="primary" />}>
              {t(($) => $['operation.close'], { ns: 'common' })}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default EvaluationNodeNameNotice
