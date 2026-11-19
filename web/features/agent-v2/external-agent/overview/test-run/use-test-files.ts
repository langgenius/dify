import type { ExternalTestFileResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { TestFileRules } from './file-limits'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid4 } from 'uuid'
import { consoleQuery } from '@/service/console'
import { localFileMime, suggestedLinkFile } from './file-limits'

export type TestAgentAttachment = {
  id: string
  name: string
  pageSessionId: string
  size: number
  state: 'uploading' | 'ready' | 'error'
  lease?: ExternalTestFileResponse
  submitted?: boolean
  error?: string
}
type FilePreparation = {
  scope: string
  mediaType?: string
  size: number
  prepareLease: () => Promise<ExternalTestFileResponse>
}

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback
export function useTestAgentFiles({
  agentId,
  pageSessionId,
  rules,
}: {
  agentId: string
  pageSessionId: string
  rules: TestFileRules | null
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [items, setItems] = useState<TestAgentAttachment[]>([])
  const itemsRef = useRef<TestAgentAttachment[]>([])
  const rulesRef = useRef(rules)
  const [failure, setFailure] = useState<string | null>(null)
  const scope = `${agentId}:${pageSessionId}`
  const scopeRef = useRef(scope)
  const mountedRef = useRef(true)
  const removedIdsRef = useRef(new Set<string>())
  const preparationsRef = useRef(new Map<string, FilePreparation>())
  const preparingIdsRef = useRef(new Set<string>())
  useEffect(() => {
    rulesRef.current = rules
  }, [rules])
  useEffect(() => {
    scopeRef.current = scope
    const preparations = preparationsRef.current
    preparations.clear()
    return () => {
      preparations.clear()
    }
  }, [scope])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const paste = useMutation(
    consoleQuery.externalAgents.byAgentId.testFiles.pasteLink.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const upload = useMutation(
    consoleQuery.externalAgents.byAgentId.testFiles.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const release = useMutation(
    consoleQuery.externalAgents.byAgentId.testFiles.byLeaseId.delete.mutationOptions({
      context: { silent: true },
    }),
  )
  const attachments = items.filter((item) => item.pageSessionId === pageSessionId)
  function updateItems(update: (current: TestAgentAttachment[]) => TestAgentAttachment[]) {
    const next = update(itemsRef.current)
    itemsRef.current = next
    setItems(next)
  }
  function releaseLease(lease: ExternalTestFileResponse) {
    const releasedScope = scope
    release.mutate(
      { params: { agent_id: agentId, lease_id: lease.lease_id } },
      {
        onError(error) {
          if (mountedRef.current && scopeRef.current === releasedScope)
            setFailure(
              message(
                error,
                t(($) => $['api.actionFailed'], { ns: 'common' }),
              ),
            )
        },
      },
    )
  }
  async function prepare(id: string, preparation: FilePreparation) {
    if (
      preparingIdsRef.current.has(id) ||
      removedIdsRef.current.has(id) ||
      preparation.scope !== scopeRef.current
    )
      return
    preparingIdsRef.current.add(id)
    updateItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, state: 'uploading', error: undefined, lease: undefined } : item,
      ),
    )
    try {
      const lease = await preparation.prepareLease()
      if (!mountedRef.current || scopeRef.current !== preparation.scope) return
      if (removedIdsRef.current.has(id)) {
        releaseLease(lease)
        return
      }
      if (preparationsRef.current.get(id) !== preparation) return
      const previousSize = itemsRef.current.find((item) => item.id === id)?.size ?? 0
      const invalid = validate(lease.media_type, lease.size, 0, lease.size - previousSize)
      if (invalid) {
        releaseLease(lease)
        throw new Error(invalid)
      }
      preparationsRef.current.delete(id)
      updateItems((current) => {
        return current.map((item) =>
          item.id === id
            ? {
                ...item,
                name: lease.filename,
                size: lease.size,
                lease,
                state: 'ready',
                error: undefined,
              }
            : item,
        )
      })
    } catch (error) {
      if (
        !mountedRef.current ||
        scopeRef.current !== preparation.scope ||
        removedIdsRef.current.has(id) ||
        preparationsRef.current.get(id) !== preparation
      )
        return
      updateItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                state: 'error',
                error: message(
                  error,
                  t(($) => $['api.actionFailed'], { ns: 'common' }),
                ),
              }
            : item,
        ),
      )
    } finally {
      preparingIdsRef.current.delete(id)
    }
  }
  function validate(mime: string | undefined, size: number, count: number, total: number) {
    const currentRules = rulesRef.current
    const currentItems = itemsRef.current.filter((item) => item.pageSessionId === pageSessionId)
    if (!currentRules?.modes.length || (mime !== undefined && !currentRules.modes.includes(mime)))
      return t(($) => $['external.overview.testRun.fileTypeUnsupported'])
    if (currentItems.length + count > currentRules.maxFiles)
      return t(($) => $['external.overview.testRun.fileCountLimit'], {
        count: currentRules.maxFiles,
      })
    const cap = mime?.startsWith('image/')
      ? currentRules.maxImageBytes
      : currentRules.maxDocumentBytes
    if (size > cap)
      return t(($) => $['external.overview.testRun.fileSizeLimit'], {
        size: `${cap.toLocaleString()} B`,
      })
    if (currentItems.reduce((sum, item) => sum + item.size, 0) + total > currentRules.maxTotalBytes)
      return t(($) => $['external.overview.testRun.fileTotalLimit'], {
        size: `${currentRules.maxTotalBytes.toLocaleString()} B`,
      })
    return null
  }
  function pasteLink(url: string) {
    const error = validate(undefined, 0, 1, 0)
    if (error) {
      setFailure(error)
      return false
    }
    setFailure(null)
    const id = uuid4()
    const filename =
      suggestedLinkFile(url, rules?.fileTypes ?? []).name ||
      t(($) => $['external.overview.fileLink'])
    const preparation: FilePreparation = {
      scope,
      size: 0,
      prepareLease: () =>
        paste.mutateAsync({
          params: { agent_id: agentId },
          body: { page_session_id: pageSessionId, url },
        }),
    }
    preparationsRef.current.set(id, preparation)
    updateItems((current) => [
      ...current,
      { id, name: filename, pageSessionId, size: 0, state: 'uploading' },
    ])
    void prepare(id, preparation)
    return true
  }
  function uploadFiles(files: File[]) {
    if (!files.length) return false
    let total = 0
    for (const file of files) {
      total += file.size
      const error = validate(
        localFileMime(file, rules?.fileTypes ?? []),
        file.size,
        files.length,
        total,
      )
      if (error) {
        setFailure(error)
        return false
      }
    }
    setFailure(null)
    for (const file of files) {
      const id = uuid4()
      const mime = localFileMime(file, rules?.fileTypes ?? [])
      const uploadFile =
        file.type === mime
          ? file
          : new File([file], file.name, { type: mime, lastModified: file.lastModified })
      const preparation: FilePreparation = {
        scope,
        mediaType: mime,
        size: file.size,
        prepareLease: () =>
          upload.mutateAsync({
            params: { agent_id: agentId },
            body: { file: uploadFile, page_session_id: pageSessionId },
          }),
      }
      preparationsRef.current.set(id, preparation)
      updateItems((current) => [
        ...current,
        { id, name: file.name, pageSessionId, size: file.size, state: 'uploading' },
      ])
      void prepare(id, preparation)
    }
    return true
  }
  function retry(id: string) {
    const preparation = preparationsRef.current.get(id)
    if (
      !preparation ||
      preparation.scope !== scope ||
      preparingIdsRef.current.has(id) ||
      removedIdsRef.current.has(id) ||
      !attachments.some((item) => item.id === id && item.state === 'error')
    )
      return false
    const error = validate(preparation.mediaType, preparation.size, 0, 0)
    if (error) {
      setFailure(error)
      return false
    }
    setFailure(null)
    void prepare(id, preparation)
    return true
  }
  function remove(id: string) {
    removedIdsRef.current.add(id)
    preparationsRef.current.delete(id)
    const item = attachments.find((item) => item.id === id)
    updateItems((current) => current.filter((item) => item.id !== id))
    setFailure(null)
    if (item?.lease) releaseLease(item.lease)
  }
  function markSubmitted(leaseIds: readonly string[]) {
    updateItems((current) =>
      current.map((item) =>
        item.lease && leaseIds.includes(item.lease.lease_id) ? { ...item, submitted: true } : item,
      ),
    )
  }
  function selectedLeaseIds() {
    if (attachments.some((item) => item.state !== 'ready' || !item.lease)) return null
    for (const item of attachments) {
      if (!item.lease) return null
      const error = validate(item.lease.media_type, item.lease.size, 0, 0)
      if (error) {
        setFailure(error)
        return null
      }
    }
    if (
      attachments.some(
        (item) => !item.submitted && item.lease && Date.parse(item.lease.expires_at) <= Date.now(),
      )
    ) {
      setFailure(t(($) => $['external.overview.testRun.fileExpired']))
      return null
    }
    if (rules && attachments.reduce((sum, item) => sum + item.size, 0) > rules.maxTotalBytes) {
      setFailure(
        t(($) => $['external.overview.testRun.fileTotalLimit'], {
          size: `${rules.maxTotalBytes.toLocaleString()} B`,
        }),
      )
      return null
    }
    return attachments.flatMap((item) => (item.lease ? [item.lease.lease_id] : []))
  }
  return {
    attachments,
    failure,
    pasteLink,
    uploadFiles,
    retry,
    remove,
    markSubmitted,
    selectedLeaseIds,
    ready: attachments.every((item) => item.state === 'ready'),
  }
}
