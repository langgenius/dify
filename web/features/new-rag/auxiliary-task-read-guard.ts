import { useCallback, useEffect, useRef, useState } from 'react'
import { taskVersionIsAfter } from './document-model'

export type AuxiliaryTaskReadGuard = ReturnType<typeof createAuxiliaryTaskReadGuard>

type RefetchDocuments = (options: { cancelRefetch: true }) => Promise<{ error: unknown }>

export function createAuxiliaryTaskReadGuard() {
  const blockedVersions = new Map<string, string>()

  return {
    block(taskId: string, taskVersion: string) {
      const blockedVersion = blockedVersions.get(taskId)
      if (blockedVersion && taskVersionIsAfter(blockedVersion, taskVersion)) return
      blockedVersions.set(taskId, taskVersion)
    },
    clear() {
      blockedVersions.clear()
    },
    clearTask(taskId: string) {
      blockedVersions.delete(taskId)
    },
    isBlocked(taskId: string, taskVersion: string) {
      return blockedVersions.get(taskId) === taskVersion
    },
    retain(taskIds: Set<string>) {
      for (const taskId of blockedVersions.keys()) {
        if (!taskIds.has(taskId)) blockedVersions.delete(taskId)
      }
    },
  }
}

export function useAuxiliaryTaskReadGuard({
  documentPermissionDenied,
  refetchDocuments,
}: {
  documentPermissionDenied: boolean
  refetchDocuments: RefetchDocuments
}) {
  const guardRef = useRef<AuxiliaryTaskReadGuard | null>(null)
  if (!guardRef.current) guardRef.current = createAuxiliaryTaskReadGuard()
  const guard = guardRef.current
  const previousDocumentPermissionDeniedRef = useRef(documentPermissionDenied)
  const denialGenerationRef = useRef(0)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [guardRevision, setGuardRevision] = useState(0)

  useEffect(() => {
    const wasDenied = previousDocumentPermissionDeniedRef.current
    previousDocumentPermissionDeniedRef.current = documentPermissionDenied
    if (!wasDenied || documentPermissionDenied) return
    guard.clear()
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- The authoritative document permission transition retires the local denial.
    setPermissionDenied(false)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Guard mutations need one render so blocked readers are reconsidered.
    setGuardRevision((current) => current + 1)
  }, [documentPermissionDenied, guard])

  const retry = useCallback(() => {
    const denialGeneration = denialGenerationRef.current + 1
    denialGenerationRef.current = denialGeneration
    setPermissionDenied(true)
    void refetchDocuments({ cancelRefetch: true }).then(
      (result) => {
        if (denialGenerationRef.current === denialGeneration && !result.error)
          setPermissionDenied(false)
      },
      () => undefined,
    )
  }, [refetchDocuments])

  const deny = useCallback(
    (taskId: string, taskVersion: string) => {
      guard.block(taskId, taskVersion)
      retry()
    },
    [guard, retry],
  )

  return { deny, guard, guardRevision, permissionDenied, retry }
}
