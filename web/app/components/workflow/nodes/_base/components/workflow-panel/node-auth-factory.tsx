import { AuthCategory, AuthorizedInNode } from '@/app/components/plugins/plugin-auth'
import { SubscriptionMenu } from '@/app/components/workflow/nodes/trigger-plugin/components/subscription-menu'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import { canFindTool } from '@/utils'
import type { FC } from 'react'
import { memo, useMemo } from 'react'

type NodeAuthProps = {
  data: Node['data']
  onAuthorizationChange: (credential_id: string) => void
  onSubscriptionChange?: (id: string, name: string) => void
}

const NodeAuth: FC<NodeAuthProps> = ({ data, onAuthorizationChange, onSubscriptionChange }) => {
  const buildInTools = useStore(s => s.buildInTools)

  const currCollection = useMemo(() => {
    return buildInTools.find(item => canFindTool(item.id, data.provider_id))
  }, [buildInTools, data.provider_id])

  if (data.type === BlockEnum.Tool && currCollection?.allow_delete) {
    return (
      <AuthorizedInNode
        pluginPayload={{
          provider: currCollection?.name || '',
          category: AuthCategory.tool,
        }}
        onAuthorizationItemClick={onAuthorizationChange}
        credentialId={data.credential_id}
      />
    )
  }

  if (data.type === BlockEnum.TriggerPlugin) {
    return (
      <SubscriptionMenu
        // @ts-expect-error TODO: fix this
        payload={data}
        onSubscriptionSelect={({ id, name }) => onSubscriptionChange?.(id, name)}
      />
    )
  }

  return null
}

export default memo(NodeAuth)
