import type { TestCredentialPreflightResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ToolNodeType } from '../../nodes/tool/types'
import type { Node } from '../../types'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNodes, useReactFlow } from 'reactflow'
import { consoleQuery } from '@/service/console'
import { workflowAppIdentityAtom } from '../../editor-resource/state'
import { useNodeDataUpdate } from '../../hooks/use-node-data-update'
import { useNodesSyncDraft } from '../../hooks/use-nodes-sync-draft'
import { useNodesReadOnly } from '../../hooks/use-workflow'
import { ToolCredentialSource } from '../../nodes/tool/types'
import { BlockEnum } from '../../types'

function getTestNodes(nodes: Node[]) {
  return nodes.filter(
    (node): node is Node<ToolNodeType> =>
      node.data.type === BlockEnum.Tool &&
      'credential_source' in node.data &&
      node.data.credential_source === ToolCredentialSource.EndUser,
  )
}

function getSelectionKey(nodes: Node[]) {
  return JSON.stringify(
    getTestNodes(nodes).map(({ id, data }) => [
      id,
      data.provider_type,
      data.provider_id,
      data.tool_name,
      data.test_credential_id,
      data.end_user_auth?.allowed_credential_types,
    ]),
  )
}

export function useTestConnections() {
  const nodes = useNodes<ToolNodeType>()
  const graph = useReactFlow<ToolNodeType>()
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { getNodesReadOnly } = useNodesReadOnly()
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)
  const generationRef = useRef(0)
  const cancelPendingCheck = useCallback(() => {
    generationRef.current += 1
  }, [])
  useEffect(() => cancelPendingCheck, [cancelPendingCheck])
  const [error, setError] = useState(false)
  const [result, setResult] = useState<{
    key: string
    data: TestCredentialPreflightResponse
  }>()
  const preflight = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.testCredentials.preflight.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const testNodes = getTestNodes(nodes)
  const selectionKey = getSelectionKey(nodes)
  const credentials = result?.key === selectionKey ? result.data.credentials : []

  const check = async () => {
    if (!getTestNodes(graph.getNodes()).length) return true
    if (checkingRef.current || getNodesReadOnly()) return false
    checkingRef.current = true
    setChecking(true)
    setError(false)
    const key = getSelectionKey(graph.getNodes())
    const generation = generationRef.current
    try {
      // Preflight reads the saved draft, including selections just changed in the picker.
      const saved = await doSyncWorkflowDraft(true)
      if (generation !== generationRef.current) return false
      if (!saved) {
        setError(true)
        return false
      }
      const data = await preflight.mutateAsync({ params: { app_id: appId } })
      if (generation !== generationRef.current || key !== getSelectionKey(graph.getNodes()))
        return false
      setResult({ key, data })
      return data.ready
    } catch {
      setError(true)
      return false
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }

  const onSelect = (nodeId: string, credentialId: string) => {
    if (checkingRef.current || getNodesReadOnly()) return
    const node = getTestNodes(graph.getNodes()).find((item) => item.id === nodeId)
    if (!node) return
    handleNodeDataUpdate({ id: nodeId, data: { test_credential_id: credentialId } })
    void check()
  }

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) void check()
  }

  const beforeSend = async ({ openOnFailure }: { openOnFailure: boolean }) => {
    const generation = generationRef.current
    const ready = await check()
    if (generation !== generationRef.current) return false
    if (!ready && openOnFailure) setOpen(true)
    return ready
  }

  return {
    nodes: testNodes,
    credentials,
    warningCount: testNodes.filter((node) => {
      if (!node.data.test_credential_id) return true
      const state = credentials.find((item) => item.node_id === node.id)
      return !!state && state.status !== 'connected'
    }).length,
    open,
    checking,
    error,
    onOpenChange,
    onSelect,
    check,
    beforeSend,
    cancelPendingCheck,
  }
}
