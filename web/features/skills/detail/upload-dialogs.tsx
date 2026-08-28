'use client'

import type { SkillUploadQueueItem } from './shared'
import type { SkillUploadDecision, SkillUploadReviewItem } from './upload-workflow'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { getPathBaseName } from './shared'
import { isUploadReviewItemSkipped, isUploadReviewResolved } from './upload-workflow'

function getUploadIconClass(name: string) {
  const extension = name.split('.').at(-1)?.toLowerCase()
  if (extension === 'pdf') return 'i-ri-file-pdf-2-fill text-util-colors-red-red-600'
  if (extension === 'md') return 'i-ri-markdown-fill text-util-colors-blue-blue-600'
  if (['xls', 'xlsx'].includes(extension ?? ''))
    return 'i-ri-file-excel-2-fill text-util-colors-green-green-600'
  return 'i-ri-file-fill text-text-quaternary'
}

function UploadRowShell({
  actions,
  message,
  name,
  success = false,
}: {
  actions?: React.ReactNode
  message: string
  name: string
  success?: boolean
}) {
  return (
    <div className="flex min-h-[50px] items-center gap-2 rounded-[10px] bg-background-section px-3 py-1.5">
      <span aria-hidden className={cn('size-5 shrink-0', getUploadIconClass(name))} />
      <div className="min-w-0 flex-1">
        <div className="truncate system-sm-medium text-text-primary" title={name}>
          {name}
        </div>
        <div
          className={cn(
            'truncate system-xs-regular',
            success ? 'text-text-success' : 'text-text-warning-secondary',
          )}
          title={message}
        >
          {message}
        </div>
      </div>
      {!!actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}

function DecisionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button size="small" variant="secondary" onClick={onClick}>
      {children}
    </Button>
  )
}

function getCheckMessage(
  item: SkillUploadReviewItem,
  t: ReturnType<typeof useTranslation<'skill'>>['t'],
) {
  const code = item.check.errors?.[0]?.code
  if (code === 'file_already_exists' || code === 'duplicate_file_path')
    return t(($) => $['skillManagement.detail.uploadConflict'])
  if (code === 'invalid_filename') {
    const suggestion = item.suggestedPath
      ? ` Suggested: ${getPathBaseName(item.suggestedPath)}`
      : ''
    return `${t(($) => $['skillManagement.detail.uploadInvalidName'])}${suggestion}`
  }
  if (code === 'invalid_file_extension')
    return t(($) => $['skillManagement.detail.uploadInvalidExtension'])
  if (code === 'missing_file_extension')
    return t(($) => $['skillManagement.detail.uploadMissingExtension'])
  return t(($) => $['skillManagement.detail.uploadInvalidPath'])
}

function getResolvedMessage(
  item: SkillUploadReviewItem,
  t: ReturnType<typeof useTranslation<'skill'>>['t'],
) {
  if (item.decision === 'replace') return t(($) => $['skillManagement.detail.uploadWillReplace'])
  return t(($) => $['skillManagement.detail.uploadWillUseName'], {
    name: getPathBaseName(item.resolvedPath ?? item.originalPath),
  })
}

function UploadReviewRow({
  item,
  onDecision,
}: {
  item: SkillUploadReviewItem
  onDecision: (id: string, decision: SkillUploadDecision) => void
}) {
  const { t } = useTranslation('skill')
  const resolved = item.kind === 'ready' || (item.decision && item.decision !== 'skip')
  const actions =
    !item.decision && item.kind === 'conflict' ? (
      <>
        <DecisionButton onClick={() => onDecision(item.id, 'replace')}>
          {t(($) => $['skillManagement.detail.uploadReplace'])}
        </DecisionButton>
        <DecisionButton onClick={() => onDecision(item.id, 'keep-both')}>
          {t(($) => $['skillManagement.detail.uploadKeepBoth'])}
        </DecisionButton>
        <DecisionButton onClick={() => onDecision(item.id, 'skip')}>
          {t(($) => $['skillManagement.detail.uploadSkip'])}
        </DecisionButton>
      </>
    ) : !item.decision && item.kind === 'invalid-name' ? (
      <>
        <DecisionButton onClick={() => onDecision(item.id, 'use-suggestion')}>
          {t(($) => $['skillManagement.detail.uploadSuggestion'])}
        </DecisionButton>
        <DecisionButton onClick={() => onDecision(item.id, 'skip')}>
          {t(($) => $['skillManagement.detail.uploadSkip'])}
        </DecisionButton>
      </>
    ) : undefined

  return (
    <UploadRowShell
      name={getPathBaseName(item.originalPath)}
      message={resolved ? getResolvedMessage(item, t) : getCheckMessage(item, t)}
      success={Boolean(resolved)}
      actions={actions}
    />
  )
}

export function SkillUploadReviewDialog({
  items,
  onDecision,
  onOpenChange,
  onUpload,
  open,
}: {
  items: SkillUploadReviewItem[]
  onDecision: (id: string, decision: SkillUploadDecision) => void
  onOpenChange: (open: boolean) => void
  onUpload: () => void
  open: boolean
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const skippedItems = items.filter(isUploadReviewItemSkipped)
  const candidateItems = items.filter((item) => !isUploadReviewItemSkipped(item))
  const unresolvedCount = candidateItems.filter((item) => !isUploadReviewResolved(item)).length
  const readyCount = candidateItems.filter((item) => isUploadReviewResolved(item)).length
  const summary =
    unresolvedCount > 0
      ? t(($) => $['skillManagement.detail.uploadReadySummary'], {
          decisions: unresolvedCount,
          ready: readyCount,
          skipped: skippedItems.length,
        })
      : t(($) => $['skillManagement.detail.uploadResolvedSummary'], {
          ready: readyCount,
          skipped: skippedItems.length,
        })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[600px] max-w-[calc(100vw-32px)] overflow-hidden! p-0!">
        <DialogClose
          render={
            <IconButton
              aria-label={tCommon(($) => $['operation.close'])}
              size="lg"
              className="absolute inset-e-5 top-5"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <header className="px-6 pt-6 pr-14 pb-3">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['skillManagement.detail.uploadReviewTitle'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {summary}
          </DialogDescription>
        </header>
        <div className="flex max-h-[min(520px,60dvh)] flex-col gap-4 overflow-y-auto px-6 py-3">
          {candidateItems.length > 0 && (
            <div className="flex flex-col gap-1">
              {candidateItems.map((item) => (
                <UploadReviewRow key={item.id} item={item} onDecision={onDecision} />
              ))}
            </div>
          )}
          {skippedItems.length > 0 && (
            <section className="flex flex-col gap-1">
              <div className="flex h-6 items-center system-sm-medium text-text-secondary">
                {t(($) => $['skillManagement.detail.uploadSkippedGroup'], {
                  count: skippedItems.length,
                })}
              </div>
              {skippedItems.map((item) => (
                <UploadReviewRow key={item.id} item={item} onDecision={onDecision} />
              ))}
            </section>
          )}
        </div>
        <footer className="flex h-[76px] items-start justify-end gap-2 px-6 pt-5 pb-6">
          <DialogClose render={<Button size="large" />}>
            {tCommon(($) => $['operation.cancel'])}
          </DialogClose>
          <Button
            size="large"
            variant="primary"
            disabled={unresolvedCount > 0 || readyCount === 0}
            onClick={onUpload}
          >
            {t(($) => $['skillManagement.detail.uploadFilesButton'], { count: readyCount })}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

export function SkillUploadFailuresDialog({
  items,
  onDecision,
  onDismiss,
  onRetry,
  onRetryItem,
  open,
}: {
  items: SkillUploadQueueItem[]
  onDecision: (id: string, decision: SkillUploadDecision) => void
  onDismiss: () => void
  onRetry: () => void
  onRetryItem: (id: string) => void
  open: boolean
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const failedItems = items.filter((item) => item.status === 'failed')
  const retryableItems = failedItems.filter((item) => item.failureKind !== 'conflict')
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onDismiss()}>
      <DialogContent className="w-[600px] max-w-[calc(100vw-32px)] overflow-hidden! p-0!">
        <DialogClose
          render={
            <IconButton
              aria-label={tCommon(($) => $['operation.close'])}
              size="lg"
              className="absolute inset-e-5 top-5"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <header className="px-6 pt-6 pr-14 pb-3">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['skillManagement.detail.uploadFailureTitle'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['skillManagement.detail.uploadFailureSummary'], {
              failed: failedItems.length,
              total: items.length,
            })}
          </DialogDescription>
        </header>
        <div className="flex max-h-[min(520px,60dvh)] flex-col gap-1 overflow-y-auto px-6 py-3">
          {failedItems.map((item) => (
            <UploadRowShell
              key={item.id}
              name={getPathBaseName(item.name)}
              message={item.error ?? t(($) => $['skillManagement.detail.uploadNetworkFailure'])}
              actions={
                item.failureKind === 'conflict' ? (
                  <>
                    <DecisionButton onClick={() => onDecision(item.id, 'replace')}>
                      {t(($) => $['skillManagement.detail.uploadReplace'])}
                    </DecisionButton>
                    <DecisionButton onClick={() => onDecision(item.id, 'keep-both')}>
                      {t(($) => $['skillManagement.detail.uploadKeepBoth'])}
                    </DecisionButton>
                    <DecisionButton onClick={() => onDecision(item.id, 'skip')}>
                      {t(($) => $['skillManagement.detail.uploadSkip'])}
                    </DecisionButton>
                  </>
                ) : (
                  <DecisionButton onClick={() => onRetryItem(item.id)}>
                    {tCommon(($) => $['operation.retry'])}
                  </DecisionButton>
                )
              }
            />
          ))}
        </div>
        <footer className="flex h-[76px] items-start justify-end gap-2 px-6 pt-5 pb-6">
          <DialogClose render={<Button size="large" />}>
            {tCommon(($) => $['operation.cancel'])}
          </DialogClose>
          <Button
            size="large"
            variant="primary"
            disabled={retryableItems.length === 0}
            onClick={onRetry}
          >
            {t(($) => $['skillManagement.detail.uploadRetryCount'], {
              count: retryableItems.length,
            })}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
