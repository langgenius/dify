import type { ExternalTestFileResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { TestFileRules } from './file-limits'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { localFileMime } from './file-limits'

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
  const [failure, setFailure] = useState<string | null>(null)
  const scope = `${agentId}:${pageSessionId}`
  const scopeRef = useRef(scope)
  const mountedRef = useRef(true)
  const removedIdsRef = useRef(new Set<string>())
  useEffect(() => {
    scopeRef.current = scope
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
  function releaseLease(lease: ExternalTestFileResponse) {
    release.mutate(
      { params: { agent_id: agentId, lease_id: lease.lease_id } },
      {
        onError(error) {
          if (mountedRef.current)
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
  async function prepare(id: string, prepareLease: () => Promise<ExternalTestFileResponse>) {
    const submittedScope = scope
    try {
      const lease = await prepareLease()
      if (!mountedRef.current || scopeRef.current !== submittedScope) return
      if (removedIdsRef.current.has(id)) {
        releaseLease(lease)
        return
      }
      setItems((current) => {
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
      if (!mountedRef.current || scopeRef.current !== submittedScope) return
      setItems((current) =>
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
    }
  }
  function validate(mime: string, size: number, count: number, total: number) {
    if (!rules || !rules.modes.includes(mime))
      return t(($) => $['external.overview.testRun.fileTypeUnsupported'])
    if (attachments.length + count > rules.maxFiles)
      return t(($) => $['external.overview.testRun.fileCountLimit'], { count: rules.maxFiles })
    const cap = mime.startsWith('image/') ? rules.maxImageBytes : rules.maxDocumentBytes
    if (size > cap)
      return t(($) => $['external.overview.testRun.fileSizeLimit'], {
        size: `${cap.toLocaleString()} B`,
      })
    if (attachments.reduce((sum, item) => sum + item.size, 0) + total > rules.maxTotalBytes)
      return t(($) => $['external.overview.testRun.fileTotalLimit'], {
        size: `${rules.maxTotalBytes.toLocaleString()} B`,
      })
    return null
  }
  function pasteLink(url: string, filename: string, mediaType: string) {
    const error = validate(mediaType, 0, 1, 0)
    if (error) {
      setFailure(error)
      return false
    }
    setFailure(null)
    const id = crypto.randomUUID()
    setItems((current) => [
      ...current,
      { id, name: filename, pageSessionId, size: 0, state: 'uploading' },
    ])
    void prepare(id, () =>
      paste.mutateAsync({
        params: { agent_id: agentId },
        body: { page_session_id: pageSessionId, url, filename, media_type: mediaType },
      }),
    )
    return true
  }
  function uploadFiles(files: File[]) {
    if (!files.length) return false
    let total = 0
    for (const file of files) {
      total += file.size
      const error = validate(localFileMime(file), file.size, files.length, total)
      if (error) {
        setFailure(error)
        return false
      }
    }
    setFailure(null)
    for (const file of files) {
      const id = crypto.randomUUID()
      const mime = localFileMime(file)
      const uploadFile =
        file.type === mime
          ? file
          : new File([file], file.name, { type: mime, lastModified: file.lastModified })
      setItems((current) => [
        ...current,
        { id, name: file.name, pageSessionId, size: file.size, state: 'uploading' },
      ])
      void prepare(id, () =>
        // The generated input omits this existing endpoint's multipart body.
        upload.mutateAsync({
          params: { agent_id: agentId },
          body: { file: uploadFile, page_session_id: pageSessionId },
        } as Parameters<typeof upload.mutateAsync>[0]),
      )
    }
    return true
  }
  function remove(id: string) {
    removedIdsRef.current.add(id)
    const item = attachments.find((item) => item.id === id)
    setItems((current) => current.filter((item) => item.id !== id))
    setFailure(null)
    if (item?.lease) releaseLease(item.lease)
  }
  function markSubmitted(leaseIds: readonly string[]) {
    setItems((current) =>
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
    remove,
    markSubmitted,
    selectedLeaseIds,
    ready: attachments.every((item) => item.state === 'ready'),
  }
}
