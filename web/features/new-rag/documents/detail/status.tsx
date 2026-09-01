import type { RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentTaskWorkflow, useDocumentWriteAccess } from './workflow-context'

export function DocumentTaskNotices({
  titleRef,
  onViewTasks,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>
  onViewTasks: () => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const {
    continueLookup,
    isLookingUp: isLookingUpTask,
    latestTask,
    lookupExhausted,
    refetch,
    reindexInProgress,
    tasksError,
  } = useDocumentTaskWorkflow()

  return (
    <>
      {reindexInProgress && (
        <div
          className="mt-4 flex items-center gap-2 rounded-lg bg-state-accent-hover px-3 py-2 system-xs-regular text-text-accent"
          role="status"
        >
          <span
            aria-hidden
            className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
          />
          <span className="min-w-0 flex-1">
            {t(($) => $['newKnowledge.documentReindexStatus'])}
          </span>
          <Button size="small" variant="ghost-accent" onClick={onViewTasks}>
            {t(($) => $['newKnowledge.viewTask'])}
          </Button>
        </div>
      )}
      {latestTask?.state === 'failed' && (
        <div
          className="mt-4 flex items-center gap-2 rounded-lg bg-state-destructive-hover px-3 py-2 system-xs-regular text-text-destructive"
          role="alert"
        >
          <span aria-hidden className="i-ri-error-warning-fill size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {t(($) => $['newKnowledge.documentReindexFailed'])}
          </span>
          <Button size="small" variant="ghost" onClick={onViewTasks}>
            {t(($) => $['newKnowledge.viewTask'])}
          </Button>
        </div>
      )}

      {tasksError && (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          role="alert"
        >
          <span>{t(($) => $['newKnowledge.tasksErrorDescription'])}</span>
          <Button onClick={() => void refetch()}>{tCommon(($) => $['operation.retry'])}</Button>
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
    </>
  )
}

export function DocumentPermissionRecoveryNotice({
  titleRef,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { permissionRecoveryBusy, permissionRecoveryNeeded, retryWritePermission } =
    useDocumentWriteAccess()
  const permissionRetryRef = useRef<HTMLButtonElement>(null)
  const permissionRecoveryWasNeededRef = useRef(false)

  useEffect(() => {
    if (permissionRecoveryNeeded && !permissionRecoveryWasNeededRef.current)
      requestAnimationFrame(() => permissionRetryRef.current?.focus())
    permissionRecoveryWasNeededRef.current = permissionRecoveryNeeded
  }, [permissionRecoveryNeeded])

  if (!permissionRecoveryNeeded) return null

  return (
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
  )
}
