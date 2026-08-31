'use client'

import type { ReactNode } from 'react'
import type { PermissionRecoveryReadStatus, PermissionRecoveryWriteStatus } from './runtime-state'
import { Button } from '@langgenius/dify-ui/button'
import { createContext, use, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export type DocumentPermissionRecoverySurface = {
  canRead: boolean
  canRetryRead: boolean
  denialIdentity: string
  readStatus: PermissionRecoveryReadStatus
  retryRead: () => void
  writeStatus: PermissionRecoveryWriteStatus
}

const RecoveryFocusContext = createContext<
  | {
      requestReadRecoveryFocus: (denialIdentity: string) => void
    }
  | undefined
>(undefined)

const TITLE_SELECTOR = '#new-knowledge-documents-title'
const ALERT_SELECTOR = '[data-document-permission-recovery-alert]'
const BULK_REGION_SELECTOR = '[data-document-permission-recovery-bulk]'

export function DocumentPermissionRecoveryBoundary({
  bulkActionsVisible,
  children,
  onReadDenied,
  readSurfaceOpen,
  recoverySurface,
}: {
  bulkActionsVisible: boolean
  children: ReactNode
  onReadDenied: () => void
  readSurfaceOpen: boolean
  recoverySurface: DocumentPermissionRecoverySurface
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const surfaceHadFocusRef = useRef(false)
  const bulkActionsHadFocusRef = useRef(false)
  const previousCanReadRef = useRef(recoverySurface.canRead)
  const previousWriteStatusRef = useRef(recoverySurface.writeStatus)
  const previousBulkActionsVisibleRef = useRef(bulkActionsVisible)
  const pendingReadRecoveryFocusRef = useRef<string | undefined>(undefined)

  const focus = (selector: string) => {
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus()
  }

  useLayoutEffect(() => {
    const wasReadable = previousCanReadRef.current
    previousCanReadRef.current = recoverySurface.canRead
    if (wasReadable && !recoverySurface.canRead) {
      const shouldRestoreFocus =
        readSurfaceOpen || surfaceHadFocusRef.current || bulkActionsHadFocusRef.current
      onReadDenied()
      if (shouldRestoreFocus) focus(ALERT_SELECTOR)
      bulkActionsHadFocusRef.current = false
      return
    }
    if (!wasReadable && recoverySurface.canRead) {
      if (surfaceHadFocusRef.current || bulkActionsHadFocusRef.current) focus(TITLE_SELECTOR)
      bulkActionsHadFocusRef.current = false
    }
  }, [onReadDenied, readSurfaceOpen, recoverySurface.canRead])

  useLayoutEffect(() => {
    const previousStatus = previousWriteStatusRef.current
    previousWriteStatusRef.current = recoverySurface.writeStatus
    if (previousStatus === 'writable' && recoverySurface.writeStatus !== 'writable') {
      if (surfaceHadFocusRef.current) focus(TITLE_SELECTOR)
    }
  }, [recoverySurface.writeStatus])

  useLayoutEffect(() => {
    const wasVisible = previousBulkActionsVisibleRef.current
    previousBulkActionsVisibleRef.current = bulkActionsVisible
    if (!wasVisible || bulkActionsVisible || !bulkActionsHadFocusRef.current) return
    if (!recoverySurface.canRead) return
    bulkActionsHadFocusRef.current = false
    focus(TITLE_SELECTOR)
  }, [bulkActionsVisible, recoverySurface.canRead])

  useLayoutEffect(() => {
    const requestedForIdentity = pendingReadRecoveryFocusRef.current
    if (!requestedForIdentity || requestedForIdentity === recoverySurface.denialIdentity) return
    pendingReadRecoveryFocusRef.current = undefined
    focus(recoverySurface.canRead ? TITLE_SELECTOR : ALERT_SELECTOR)
  }, [recoverySurface.canRead, recoverySurface.denialIdentity])

  const focusContext = useMemo(
    () => ({
      requestReadRecoveryFocus(denialIdentity: string) {
        pendingReadRecoveryFocusRef.current = denialIdentity
      },
    }),
    [],
  )

  return (
    <RecoveryFocusContext value={focusContext}>
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
    </RecoveryFocusContext>
  )
}

export function DocumentPermissionRecoveryBulkRegion({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-document-permission-recovery-bulk>
      {children}
    </div>
  )
}

export function DocumentReadPermissionRecovery({
  fetching,
  recoverySurface,
}: {
  fetching: boolean
  recoverySurface: DocumentPermissionRecoverySurface
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const focusContext = use(RecoveryFocusContext)

  return (
    <div
      className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center"
      data-document-permission-recovery-alert
      role="alert"
      tabIndex={-1}
    >
      <span aria-hidden className="i-ri-error-warning-line size-7 text-text-tertiary" />
      <h2 className="mt-3 title-xl-semi-bold text-text-primary">
        {t(($) => $['newKnowledge.documentsPermissionTitle'])}
      </h2>
      <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
        {t(($) => $['newKnowledge.documentsPermissionDescription'])}
      </p>
      {recoverySurface.canRetryRead && (
        <Button
          aria-label={`${tCommon(($) => $['operation.retry'])} · ${t(($) => $['newKnowledge.documentsPermissionDescription'])}`}
          aria-busy={fetching}
          className="mt-4"
          loading={fetching}
          onBlur={(event) => {
            if (event.relatedTarget) focusContext?.requestReadRecoveryFocus('')
          }}
          onClick={() => {
            focusContext?.requestReadRecoveryFocus(recoverySurface.denialIdentity)
            recoverySurface.retryRead()
          }}
        >
          {tCommon(($) => $['operation.retry'])}
        </Button>
      )}
    </div>
  )
}
