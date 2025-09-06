import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { AuthorizedInNode } from '@/app/components/plugins/plugin-auth'
import { AuthCategory } from '@/app/components/plugins/plugin-auth'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import { canFindTool } from '@/utils'
import { useStore } from '@/app/components/workflow/store'
import AuthenticationMenu from '@/app/components/workflow/nodes/trigger-plugin/components/authentication-menu'
import type { AuthSubscription } from '@/app/components/workflow/nodes/trigger-plugin/components/authentication-menu'
import {
  useConfigureTriggerOAuth,
  useDeleteTriggerSubscription,
  useTriggerSubscriptions,
} from '@/service/use-triggers'

type NodeAuthProps = {
  data: Node['data']
  onAuthorizationChange: (credential_id: string) => void
}

const NodeAuth: FC<NodeAuthProps> = ({ data, onAuthorizationChange }) => {
  const buildInTools = useStore(s => s.buildInTools)
  const provider = data.provider_id || ''

  // Always call hooks at the top level
  const { data: subscriptions = [] } = useTriggerSubscriptions(
    provider,
    data.type === BlockEnum.TriggerPlugin && !!provider,
  )
  const deleteSubscription = useDeleteTriggerSubscription()
  const configureTriggerOAuth = useConfigureTriggerOAuth()

  const currCollection = useMemo(() => {
    return buildInTools.find(item => canFindTool(item.id, data.provider_id))
  }, [buildInTools, data.provider_id])

  // Convert TriggerSubscription to AuthSubscription format
  const authSubscription: AuthSubscription = useMemo(() => {
    if (data.type !== BlockEnum.TriggerPlugin) {
      return {
        id: '',
        name: '',
        status: 'not_configured',
        credentials: {},
      }
    }

    const subscription = subscriptions[0] // Use first subscription if available

    if (!subscription) {
      return {
        id: '',
        name: '',
        status: 'not_configured',
        credentials: {},
      }
    }

    const status = subscription.credential_type === 'unauthorized'
      ? 'not_configured'
      : 'authorized'

    return {
      id: subscription.id,
      name: subscription.name,
      status,
      credentials: subscription.credentials,
    }
  }, [data.type, subscriptions])

  const handleConfigure = useCallback(() => {
    // Navigate to OAuth configuration flow
    if (provider) {
      configureTriggerOAuth.mutate({
        provider,
        client_params: {
          client_id: '',
          client_secret: '',
        },
        enabled: true,
      })
    }
  }, [provider, configureTriggerOAuth])

  const handleRemove = useCallback(() => {
    if (authSubscription.id)
      deleteSubscription.mutate(authSubscription.id)
  }, [authSubscription.id, deleteSubscription])

  // Tool authentication
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

  // Trigger Plugin authentication
  if (data.type === BlockEnum.TriggerPlugin) {
    return (
      <AuthenticationMenu
        subscription={authSubscription}
        onConfigure={handleConfigure}
        onRemove={handleRemove}
      />
    )
  }

  // No authentication needed
  return null
}

export default memo(NodeAuth)
