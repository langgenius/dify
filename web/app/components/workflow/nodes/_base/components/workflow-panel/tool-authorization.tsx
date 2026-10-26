import type { AppUserAuthDraft } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import type { PluginAuthProps } from '@/app/components/plugins/plugin-auth/plugin-auth'
import type { Collection } from '@/app/components/tools/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import { useEffect } from 'react'
import { useNodes, useReactFlow } from 'reactflow'
import { createAppUserAuthDraft } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import PluginAuth from '@/app/components/plugins/plugin-auth/plugin-auth'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodesReadOnly } from '@/app/components/workflow/hooks/use-workflow'
import {
  getAppUserAuthDraft,
  getAppUserAuthUpdate,
  getReuseAuthUpdate,
  getToolAuthorizationTab,
  getWorkspaceAuthUpdate,
} from '@/app/components/workflow/nodes/tool/authorization-config'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { getReusableToolNodes } from './reusable-tool-nodes'

type ToolAuthorizationProps = Omit<
  PluginAuthProps,
  'authorizationTab' | 'onAuthorizationTabChange' | 'appUserAuth' | 'reuseFromNode'
> & {
  nodeId: string
  providerId: string
  toolIcon?: Collection['icon']
}

const ToolAuthorization = ({ nodeId, providerId, toolIcon, ...props }: ToolAuthorizationProps) => {
  const provider = props.pluginPayload.provider
  const nodes = useNodes<ToolNodeType>()
  const graph = useReactFlow<ToolNodeType>()
  const workflowStore = useWorkflowStore()
  const drafts = useStore((state) => state.nodeAuthDrafts)
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { getNodesReadOnly } = useNodesReadOnly()
  const stored = drafts[nodeId]
  const entry =
    stored?.provider === provider && stored.providerId === providerId ? stored : undefined
  const currentNode = nodes.find((node) => node.id === nodeId)
  const authorizationTab = getToolAuthorizationTab(currentNode?.data ?? {})
  const reusableNodes = getReusableToolNodes({ nodes, nodeId, toolIcon })
  const sourceId = currentNode?.data.reuse_node_id
  const selectedSource = reusableNodes.find((node) => node.id === sourceId)
  const reference = sourceId
    ? (selectedSource ??
      (entry?.reuseFromNode?.source.id === sourceId
        ? entry.reuseFromNode.source
        : { id: sourceId, title: sourceId }))
    : undefined
  const appUserDraft =
    authorizationTab === 'app-user-auth' && currentNode
      ? getAppUserAuthDraft(currentNode.data)
      : entry?.draft

  // Cache only presentation information so a deleted source remains identifiable.
  useEffect(() => {
    const cached = entry?.reuseFromNode?.source
    if (
      !selectedSource ||
      (cached?.id === selectedSource.id &&
        cached.title === selectedSource.title &&
        cached.icon === selectedSource.icon)
    )
      return
    workflowStore.getState().setNodeReuseFromNode(nodeId, provider, providerId, {
      id: selectedSource.id,
      title: selectedSource.title,
      icon: selectedSource.icon,
    })
  }, [entry?.reuseFromNode?.source, nodeId, provider, providerId, selectedSource, workflowStore])

  const getCurrentNode = () => {
    const node = graph.getNode(nodeId)
    return node?.data.type === BlockEnum.Tool && node.data.provider_id === providerId
      ? node
      : undefined
  }
  const cacheDraft = (draft: AppUserAuthDraft) =>
    workflowStore.getState().setNodeAppUserAuthDraft(nodeId, provider, providerId, draft)

  return (
    <PluginAuth
      {...props}
      nodeAuth={
        props.nodeAuth && {
          ...props.nodeAuth,
          credentialId: currentNode?.data.credential_id,
          onAuthorizationItemClick: (id) => {
            const current = getCurrentNode()
            if (
              !current ||
              getNodesReadOnly() ||
              getToolAuthorizationTab(current.data) !== 'workspace-auth'
            )
              return
            workflowStore
              .getState()
              .cacheNodeWorkspaceCredential(nodeId, provider, providerId, id || undefined)
            handleNodeDataUpdateWithSyncDraft({ id: nodeId, data: getWorkspaceAuthUpdate(id) })
          },
        }
      }
      authorizationTab={authorizationTab}
      onAuthorizationTabChange={(tab) => {
        const current = getCurrentNode()
        if (!current || getNodesReadOnly()) return
        const previousTab = getToolAuthorizationTab(current.data)
        if (tab === previousTab) return
        const state = workflowStore.getState()
        if (previousTab === 'workspace-auth')
          state.cacheNodeWorkspaceCredential(
            nodeId,
            provider,
            providerId,
            current.data.credential_id,
          )
        else if (previousTab === 'app-user-auth') cacheDraft(getAppUserAuthDraft(current.data))

        const cached = workflowStore.getState().nodeAuthDrafts[nodeId]
        const cachedEntry =
          cached?.provider === provider && cached.providerId === providerId ? cached : undefined
        const source =
          tab === 'reuse-from-node'
            ? getReusableToolNodes({ nodes: graph.getNodes(), nodeId, toolIcon }).find(
                (candidate) => candidate.id === cachedEntry?.reuseFromNode?.source.id,
              )
            : undefined
        const clearReuseFromNode = tab === 'reuse-from-node' && (!source || source.disabled)
        state.setNodeAuthorizationTab(nodeId, provider, providerId, tab, { clearReuseFromNode })
        const data =
          tab === 'app-user-auth'
            ? getAppUserAuthUpdate(
                cachedEntry?.draft ?? createAppUserAuthDraft({ canOAuth: false, canApiKey: false }),
              )
            : tab === 'reuse-from-node'
              ? getReuseAuthUpdate(clearReuseFromNode ? undefined : source?.id)
              : getWorkspaceAuthUpdate(cachedEntry?.workspaceCredentialId)
        handleNodeDataUpdateWithSyncDraft({ id: nodeId, data })
      }}
      appUserAuth={{
        draft: appUserDraft,
        onChange: (draft) => {
          const current = getCurrentNode()
          if (!current || getNodesReadOnly()) return
          cacheDraft(draft)
          if (getToolAuthorizationTab(current.data) === 'app-user-auth')
            handleNodeDataUpdateWithSyncDraft({ id: nodeId, data: getAppUserAuthUpdate(draft) })
        },
      }}
      reuseFromNode={{
        nodes: reusableNodes,
        value: reference,
        onChange: ({ id }) => {
          const current = getCurrentNode()
          if (
            !current ||
            getNodesReadOnly() ||
            getToolAuthorizationTab(current.data) !== 'reuse-from-node'
          )
            return
          const candidate = getReusableToolNodes({
            nodes: graph.getNodes(),
            nodeId,
            toolIcon,
          }).find((node) => node.id === id)
          if (!candidate || candidate.disabled) return
          workflowStore.getState().setNodeReuseFromNode(nodeId, provider, providerId, {
            id: candidate.id,
            title: candidate.title,
            icon: candidate.icon,
          })
          handleNodeDataUpdateWithSyncDraft({ id: nodeId, data: getReuseAuthUpdate(candidate.id) })
        },
        onLocate: (id) => selectWorkflowNode(id, true),
      }}
    />
  )
}

export default ToolAuthorization
