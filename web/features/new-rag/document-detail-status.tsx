import type { DocumentProcessingTask } from '@dify/contracts/knowledge-fs/types.gen'
import type { RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export function DocumentDetailStatus({
  continueLookup,
  effectiveRevision,
  isLookingUpTask,
  latestTask,
  locale,
  lookupExhausted,
  permissionRecoveryBusy,
  permissionRecoveryNeeded,
  recheckTimedOutSubmission,
  refetchRevisions,
  refetchTasks,
  retryTimedOutSubmission,
  retryWritePermission,
  revisionHistoryBackgroundError,
  submissionRecoveryBusy,
  submissionTimedOut,
  taskIsActive,
  tasksError,
  titleRef,
}: {
  continueLookup: () => void
  effectiveRevision?: number
  isLookingUpTask: boolean
  latestTask?: DocumentProcessingTask
  locale: string
  lookupExhausted: boolean
  permissionRecoveryBusy: boolean
  permissionRecoveryNeeded: boolean
  recheckTimedOutSubmission: () => Promise<unknown>
  refetchRevisions: () => void
  refetchTasks: () => void
  retryTimedOutSubmission: () => Promise<unknown>
  retryWritePermission: () => Promise<boolean>
  revisionHistoryBackgroundError: boolean
  submissionRecoveryBusy: boolean
  submissionTimedOut: boolean
  taskIsActive: boolean
  tasksError: boolean
  titleRef: RefObject<HTMLHeadingElement | null>
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const permissionRetryRef = useRef<HTMLButtonElement>(null)
  const permissionRecoveryWasNeededRef = useRef(false)

  useEffect(() => {
    if (permissionRecoveryNeeded && !permissionRecoveryWasNeededRef.current)
      requestAnimationFrame(() => permissionRetryRef.current?.focus())
    permissionRecoveryWasNeededRef.current = permissionRecoveryNeeded
  }, [permissionRecoveryNeeded])

  return (
    <>
      {taskIsActive && (
        <div
          className="mt-4 flex items-center gap-2 rounded-lg bg-state-accent-hover px-3 py-2 system-xs-regular text-text-accent"
          role="status"
        >
          <span
            aria-hidden
            className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
          />
          {t(($) => $['newKnowledge.documentReindexProgress'], {
            progress: new Intl.NumberFormat(locale).format(latestTask?.progressPercent ?? 0),
          })}
        </div>
      )}
      {latestTask?.state === 'failed' && (
        <div
          className="mt-4 rounded-lg bg-state-destructive-hover px-3 py-2 system-xs-regular text-text-destructive"
          role="alert"
        >
          <p>{t(($) => $['newKnowledge.documentReindexFailed'])}</p>
          <p className="mt-1 text-text-secondary">
            {t(($) => $['newKnowledge.lastReadyRevisionHint'])}
          </p>
        </div>
      )}

      {tasksError && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role="alert"
        >
          <span>{t(($) => $['newKnowledge.tasksErrorDescription'])}</span>
          <Button onClick={refetchTasks}>{tCommon(($) => $['operation.retry'])}</Button>
        </div>
      )}

      {permissionRecoveryNeeded && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role="alert"
        >
          <span>{t(($) => $['newKnowledge.documentPermissionRestricted'])}</span>
          <Button
            ref={permissionRetryRef}
            disabled={permissionRecoveryBusy}
            loading={permissionRecoveryBusy}
            onClick={() =>
              void retryWritePermission().then((recovered) => {
                if (recovered) titleRef.current?.focus()
                else permissionRetryRef.current?.focus()
              })
            }
          >
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}

      {(lookupExhausted || isLookingUpTask) && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role={isLookingUpTask ? 'status' : 'alert'}
        >
          {isLookingUpTask ? (
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
              />
              {tCommon(($) => $.loading)}
            </span>
          ) : (
            <>
              <span>{t(($) => $['newKnowledge.documentTaskLookupIncomplete'])}</span>
              <Button
                onClick={() => {
                  continueLookup()
                  requestAnimationFrame(() => titleRef.current?.focus())
                }}
              >
                {t(($) => $['newKnowledge.continueCheckingTaskStatus'])}
              </Button>
            </>
          )}
        </div>
      )}

      {submissionTimedOut && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role="alert"
        >
          <span>{t(($) => $['newKnowledge.documentReindexConfirmationDelayed'])}</span>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={submissionRecoveryBusy}
              loading={submissionRecoveryBusy}
              onClick={() =>
                void recheckTimedOutSubmission().finally(() => titleRef.current?.focus())
              }
            >
              {t(($) => $['newKnowledge.checkReindexStatus'])}
            </Button>
            <Button
              disabled={submissionRecoveryBusy}
              onClick={() =>
                void retryTimedOutSubmission().finally(() => titleRef.current?.focus())
              }
            >
              {t(($) => $['newKnowledge.retryReindexDocument'])}
            </Button>
          </div>
        </div>
      )}

      {revisionHistoryBackgroundError && effectiveRevision !== undefined && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role="alert"
        >
          <span>{t(($) => $['newKnowledge.documentRevisionsLoadError'])}</span>
          <Button onClick={refetchRevisions}>{tCommon(($) => $['operation.retry'])}</Button>
        </div>
      )}
    </>
  )
}
