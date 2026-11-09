import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { taskGraphIsIncomplete } from '../model'
import { DocumentGraphStatus } from '../tasks/graph-status'
import { DOCUMENT_DETAIL_TITLE_ID } from './header'
import {
  documentLatestTaskAtom,
  documentPermissionRecoveryBusyAtom,
  documentPermissionRecoveryNeededAtom,
  documentReindexInProgressAtom,
  documentTaskSnapshotErrorAtom,
  retryDocumentTaskSnapshotAtom,
  retryDocumentWritePermissionAtom,
} from './state/workflow'
import { useRefreshDocumentWritePermission } from './write-permission'

function focusDocumentDetailTitle() {
  document.getElementById(DOCUMENT_DETAIL_TITLE_ID)?.focus()
}

export function DocumentTaskNotices({ onViewTasks }: { onViewTasks: () => void }) {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeDocuments'])
  const { t: tCommon } = useTranslation(['common'])
  const latestTask = useAtomValueRawSync(documentLatestTaskAtom)
  const reindexInProgress = useAtomValueRawSync(documentReindexInProgressAtom)
  const tasksError = useAtomValueRawSync(documentTaskSnapshotErrorAtom)
  const retryTasks = useSetAtom(retryDocumentTaskSnapshotAtom)

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
            {t(($) => $.documentReindexStatus, { ns: 'knowledgeDocuments' })}
          </span>
          <Button size="small" variant="ghost-accent" onClick={onViewTasks}>
            {t(($) => $.viewTask, { ns: 'knowledgeDocuments' })}
          </Button>
        </div>
      )}
      {latestTask && taskGraphIsIncomplete(latestTask) && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-state-warning-hover px-3 py-2">
          <div className="min-w-0 flex-1">
            <DocumentGraphStatus task={latestTask} />
          </div>
          <Button size="small" variant="ghost" onClick={onViewTasks}>
            {t(($) => $.viewTask, { ns: 'knowledgeDocuments' })}
          </Button>
        </div>
      )}
      {latestTask?.state === 'failed' && (
        <Alert type="error" className="mt-4">
          <AlertTitle>{t(($) => $.documentReindexFailed, { ns: 'knowledgeDocuments' })}</AlertTitle>
          <AlertActions>
            <Button size="small" onClick={onViewTasks}>
              {t(($) => $.viewTask, { ns: 'knowledgeDocuments' })}
            </Button>
          </AlertActions>
        </Alert>
      )}

      {tasksError && (
        <Alert type="warning" role="alert" className="mt-4">
          <AlertTitle>{t(($) => $.tasksErrorDescription)}</AlertTitle>
          <AlertActions>
            <Button size="small" onClick={() => void retryTasks()}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </AlertActions>
        </Alert>
      )}
    </>
  )
}

export function DocumentPermissionRecoveryNotice() {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const permissionRecoveryBusy = useAtomValueRawSync(documentPermissionRecoveryBusyAtom)
  const permissionRecoveryNeeded = useAtomValueRawSync(documentPermissionRecoveryNeededAtom)
  const retryWritePermission = useSetAtom(retryDocumentWritePermissionAtom)
  const refreshWritePermission = useRefreshDocumentWritePermission()
  const permissionRetryRef = useRef<HTMLButtonElement>(null)
  const permissionRecoveryWasNeededRef = useRef(false)

  useEffect(() => {
    if (permissionRecoveryNeeded && !permissionRecoveryWasNeededRef.current)
      requestAnimationFrame(() => permissionRetryRef.current?.focus())
    permissionRecoveryWasNeededRef.current = permissionRecoveryNeeded
  }, [permissionRecoveryNeeded])

  if (!permissionRecoveryNeeded) return null

  return (
    <Alert type="warning" role="alert" className="mt-4">
      <AlertTitle>{t(($) => $.documentPermissionRestricted)}</AlertTitle>
      <AlertActions>
        <Button
          size="small"
          ref={permissionRetryRef}
          loading={permissionRecoveryBusy}
          onClick={() =>
            void retryWritePermission(refreshWritePermission).then((recovered) => {
              if (recovered) focusDocumentDetailTitle()
              else permissionRetryRef.current?.focus()
            })
          }
        >
          {tCommon(($) => $['operation.retry'])}
        </Button>
      </AlertActions>
    </Alert>
  )
}
