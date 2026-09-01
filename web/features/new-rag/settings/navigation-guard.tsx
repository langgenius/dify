'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { knowledgeSettingsHasUnsavedWorkAtom } from './state/workflow'

export function KnowledgeSettingsNavigationGuard() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const hasUnsavedWork = useAtomValue(knowledgeSettingsHasUnsavedWorkAtom)
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const pendingNavigationRef = useRef<string | undefined>(undefined)
  const historyGuardArmedRef = useRef(false)
  const historyGuardReleaseRef = useRef(false)
  const browserBackPendingRef = useRef(false)
  const allowNavigationRef = useRef(false)

  const armHistoryGuard = useCallback(() => {
    globalThis.history.pushState(globalThis.history.state, '', globalThis.location.href)
    historyGuardArmedRef.current = true
  }, [])

  useEffect(() => {
    if (hasUnsavedWork) {
      if (
        !historyGuardArmedRef.current &&
        !browserBackPendingRef.current &&
        !allowNavigationRef.current
      )
        armHistoryGuard()
      return
    }
    if (!historyGuardArmedRef.current) return
    historyGuardReleaseRef.current = true
    historyGuardArmedRef.current = false
    globalThis.history.back()
  }, [armHistoryGuard, hasUnsavedWork])

  useEffect(() => {
    const handlePopState = () => {
      if (historyGuardReleaseRef.current) {
        historyGuardReleaseRef.current = false
        return
      }
      if (allowNavigationRef.current) {
        const destination = pendingNavigationRef.current
        pendingNavigationRef.current = undefined
        if (destination) router.push(destination)
        return
      }
      if (!historyGuardArmedRef.current) return

      historyGuardArmedRef.current = false
      browserBackPendingRef.current = true
      setDiscardDialogOpen(true)
    }

    globalThis.addEventListener('popstate', handlePopState)
    return () => globalThis.removeEventListener('popstate', handlePopState)
  }, [router])

  useEffect(() => {
    if (!hasUnsavedWork) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = event
        .composedPath()
        .find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement)
      if (
        !anchor ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return

      const destination = new URL(anchor.href, globalThis.location.href)
      const current = new URL(globalThis.location.href)
      if (
        destination.origin !== current.origin ||
        (destination.pathname === current.pathname &&
          destination.search === current.search &&
          destination.hash === current.hash)
      )
        return

      event.preventDefault()
      pendingNavigationRef.current = `${destination.pathname}${destination.search}${destination.hash}`
      setDiscardDialogOpen(true)
    }

    globalThis.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleDocumentClick, true)
    return () => {
      globalThis.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [hasUnsavedWork])

  const confirmDiscardAndNavigate = () => {
    const destination = pendingNavigationRef.current
    setDiscardDialogOpen(false)
    allowNavigationRef.current = true
    if (browserBackPendingRef.current) {
      browserBackPendingRef.current = false
      pendingNavigationRef.current = undefined
      globalThis.history.back()
      return
    }
    if (destination && historyGuardArmedRef.current) {
      historyGuardArmedRef.current = false
      globalThis.history.back()
      return
    }
    pendingNavigationRef.current = undefined
    if (destination) router.push(destination)
  }

  const closeDiscardDialog = () => {
    setDiscardDialogOpen(false)
    pendingNavigationRef.current = undefined
    if (!browserBackPendingRef.current) return
    browserBackPendingRef.current = false
    if (hasUnsavedWork) armHistoryGuard()
  }

  return (
    <AlertDialog
      open={discardDialogOpen}
      onOpenChange={(open) => {
        if (open) setDiscardDialogOpen(true)
        else closeDiscardDialog()
      }}
    >
      <AlertDialogContent>
        <div className="px-6 pt-6">
          <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
            {tCommon(($) => $['operation.confirmAction'])}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.discardDraftDescription'])}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton>{tCommon(($) => $['operation.cancel'])}</AlertDialogCancelButton>
          <AlertDialogConfirmButton tone="destructive" onClick={confirmDiscardAndNavigate}>
            {t(($) => $['newKnowledge.discardDraftConfirm'])}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
