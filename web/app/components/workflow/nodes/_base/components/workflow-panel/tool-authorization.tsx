import type { PluginAuthProps } from '@/app/components/plugins/plugin-auth/plugin-auth'
import type { Collection } from '@/app/components/tools/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { useEffect } from 'react'
import { useNodes, useReactFlow } from 'reactflow'
import PluginAuth from '@/app/components/plugins/plugin-auth/plugin-auth'
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
  const nodes = useNodes<CommonNodeType<ToolNodeType>>()
  const graph = useReactFlow<CommonNodeType<ToolNodeType>>()
  const workflowStore = useWorkflowStore()
  const drafts = useStore((state) => state.nodeAuthDrafts)
  const stored = drafts[nodeId]
  const setAuthorizationTab = useStore((state) => state.setNodeAuthorizationTab)
  const setDraft = useStore((state) => state.setNodeAppUserAuthDraft)
  const setReuseFromNode = useStore((state) => state.setNodeReuseFromNode)
  const entry =
    stored?.provider === provider && stored.providerId === providerId ? stored : undefined
  const currentNode = nodes.find((node) => node.id === nodeId)
  const providerType =
    currentNode?.data.type === BlockEnum.Tool ? currentNode.data.provider_type : undefined
  const reusableNodes = getReusableToolNodes({
    nodes,
    nodeId,
    provider,
    nodeAuthDrafts: drafts,
    toolIcon,
  })
  const reference = entry?.reuseFromNode?.source
  const selectedSource = reusableNodes.find((node) => node.id === reference?.id)

  // Keep the UI-only snapshot in sync with the live graph before a source disappears.
  useEffect(() => {
    if (
      !reference ||
      !selectedSource ||
      (selectedSource.title === reference.title && selectedSource.icon === reference.icon)
    )
      return

    setReuseFromNode(nodeId, provider, providerId, {
      id: selectedSource.id,
      title: selectedSource.title,
      icon: selectedSource.icon,
    })
  }, [nodeId, provider, providerId, reference, selectedSource, setReuseFromNode])

  return (
    <PluginAuth
      {...props}
      authorizationTab={entry?.authorizationTab ?? 'workspace-auth'}
      onAuthorizationTabChange={(tab) => {
        const latestDrafts = workflowStore.getState().nodeAuthDrafts
        const latestEntry = latestDrafts[nodeId]
        const latestReference =
          latestEntry?.provider === provider && latestEntry.providerId === providerId
            ? latestEntry.reuseFromNode?.source
            : undefined
        // A saved reference can become cyclic while another authorization mode is active.
        const source =
          tab === 'reuse-from-node' && latestReference
            ? getReusableToolNodes({
                nodes: graph.getNodes(),
                nodeId,
                provider,
                nodeAuthDrafts: latestDrafts,
                toolIcon,
              }).find((node) => node.id === latestReference.id)
            : undefined

        setAuthorizationTab(nodeId, provider, providerId, tab, {
          clearReuseFromNode: source?.disabled,
        })
      }}
      appUserAuth={{
        draft: entry?.draft,
        onChange: (draft) => setDraft(nodeId, provider, providerId, draft),
      }}
      reuseFromNode={{
        nodes: reusableNodes,
        value: reference,
        onChange: ({ id }) => {
          const latestNodes = graph.getNodes()
          const latestCurrent = latestNodes.find((node) => node.id === nodeId)
          if (
            latestCurrent?.data.type !== BlockEnum.Tool ||
            latestCurrent.data.provider_id !== providerId ||
            latestCurrent.data.provider_type !== providerType
          )
            return

          const candidate = getReusableToolNodes({
            nodes: latestNodes,
            nodeId,
            provider,
            nodeAuthDrafts: workflowStore.getState().nodeAuthDrafts,
            toolIcon,
          }).find((node) => node.id === id)
          if (!candidate || candidate.disabled) return

          setReuseFromNode(nodeId, provider, providerId, {
            id: candidate.id,
            title: candidate.title,
            icon: candidate.icon,
          })
        },
        onLocate: (id) => selectWorkflowNode(id, true),
      }}
    />
  )
}

export default ToolAuthorization
