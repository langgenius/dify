'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { documentMetadataParser } from '../query-state'
import { retryDocumentReadAtom } from '../state/runtime'
import { documentPermissionRecoveryFocusRequestAtom, documentTasksOpenAtom } from '../state/scoped'
import { documentPermissionBoundaryFactsAtom, documentReadRecoveryFactsAtom } from './state'

const TITLE_SELECTOR = '#new-knowledge-documents-title'
const ALERT_SELECTOR = '[data-document-permission-recovery-alert]'
const BULK_REGION_SELECTOR = '[data-document-permission-recovery-bulk]'

export function DocumentPermissionRecoveryBoundary({ children }: { children: ReactNode }) {
  const {
    bulkActionsVisible,
    canRead,
    denialIdentity,
    pendingReadRecoveryFocus,
    tasksOpen,
    writeStatus,
  } = useAtomValue(documentPermissionBoundaryFactsAtom)
  const setTasksOpen = useSetAtom(documentTasksOpenAtom)
  const setPendingReadRecoveryFocus = useSetAtom(documentPermissionRecoveryFocusRequestAtom)
  const [metadataRequest, setMetadataRequest] = useQueryState('metadata', documentMetadataParser)
  const readSurfaceOpen = tasksOpen || metadataRequest === '1'
  const closeReadSurfaces = useCallback(() => {
    setTasksOpen(false)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Permission loss closes the route-owned metadata overlay before focus restoration.
    void setMetadataRequest(null)
  }, [setMetadataRequest, setTasksOpen])
  const rootRef = useRef<HTMLDivElement>(null)
  const surfaceHadFocusRef = useRef(false)
  const bulkActionsHadFocusRef = useRef(false)
  const previousCanReadRef = useRef(canRead)
  const previousWriteStatusRef = useRef(writeStatus)
  const previousBulkActionsVisibleRef = useRef(bulkActionsVisible)

  const focus = (selector: string) => {
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus()
  }

  useLayoutEffect(() => {
    const wasReadable = previousCanReadRef.current
    previousCanReadRef.current = canRead
    if (wasReadable && !canRead) {
      const shouldRestoreFocus =
        readSurfaceOpen || surfaceHadFocusRef.current || bulkActionsHadFocusRef.current
      closeReadSurfaces()
      if (shouldRestoreFocus) focus(ALERT_SELECTOR)
      bulkActionsHadFocusRef.current = false
      return
    }
    if (!wasReadable && canRead) {
      if (surfaceHadFocusRef.current || bulkActionsHadFocusRef.current) focus(TITLE_SELECTOR)
      bulkActionsHadFocusRef.current = false
    }
  }, [canRead, closeReadSurfaces, readSurfaceOpen])

  useLayoutEffect(() => {
    const previousStatus = previousWriteStatusRef.current
    previousWriteStatusRef.current = writeStatus
    if (previousStatus === 'writable' && writeStatus !== 'writable') {
      if (surfaceHadFocusRef.current) focus(TITLE_SELECTOR)
    }
  }, [writeStatus])

  useLayoutEffect(() => {
    const wasVisible = previousBulkActionsVisibleRef.current
    previousBulkActionsVisibleRef.current = bulkActionsVisible
    if (!wasVisible || bulkActionsVisible || !bulkActionsHadFocusRef.current) return
    if (!canRead) return
    bulkActionsHadFocusRef.current = false
    focus(TITLE_SELECTOR)
  }, [bulkActionsVisible, canRead])

  useLayoutEffect(() => {
    const requestedForIdentity = pendingReadRecoveryFocus
    if (!requestedForIdentity || requestedForIdentity === denialIdentity) return
    setPendingReadRecoveryFocus(undefined)
    focus(canRead ? TITLE_SELECTOR : ALERT_SELECTOR)
  }, [canRead, denialIdentity, pendingReadRecoveryFocus, setPendingReadRecoveryFocus])

  return (
    <div
      ref={rootRef}
      className="contents"
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        surfaceHadFocusRef.current = false
        bulkActionsHadFocusRef.current = false
      }}
      onFocusCapture={(event) => {
        surfaceHadFocusRef.current = true
        bulkActionsHadFocusRef.current = Boolean(
          (event.target as Element).closest(BULK_REGION_SELECTOR),
        )
      }}
    >
      {children}
    </div>
  )
}

export function DocumentPermissionRecoveryBulkRegion({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-document-permission-recovery-bulk>
      {children}
    </div>
  )
}

export function DocumentReadPermissionRecovery() {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const { canRetryRead, denialIdentity, fetching } = useAtomValue(documentReadRecoveryFactsAtom)
  const requestReadRecoveryFocus = useSetAtom(documentPermissionRecoveryFocusRequestAtom)
  const retryRead = useSetAtom(retryDocumentReadAtom)

  return (
    <div
      className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
      data-document-permission-recovery-alert
      role="alert"
      tabIndex={-1}
    >
      <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
      <h2 className="mt-3 title-xl-semi-bold text-text-primary">
        {t(($) => $.documentsPermissionTitle)}
      </h2>
      <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
        {t(($) => $.documentsPermissionDescription)}
      </p>
      {canRetryRead && (
        <Button
          aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $.documentsPermissionDescription)}`}
          aria-busy={fetching}
          className="mt-4"
          loading={fetching}
          onBlur={(event) => {
            if (event.relatedTarget) requestReadRecoveryFocus('')
          }}
          onClick={() => {
            requestReadRecoveryFocus(denialIdentity)
            retryRead()
          }}
        >
          {tCommon(($) => $['operation.retry'])}
        </Button>
      )}
    </div>
  )
}
