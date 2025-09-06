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
  useDeleteTriggerSubscription,
  useInitiateTriggerOAuth,
  useInvalidateTriggerSubscriptions,
  useTriggerSubscriptions,
} from '@/service/use-triggers'
import { useToastContext } from '@/app/components/base/toast'

type NodeAuthProps = {
  data: Node['data']
  onAuthorizationChange: (credential_id: string) => void
}

const NodeAuth: FC<NodeAuthProps> = ({ data, onAuthorizationChange }) => {
  const buildInTools = useStore(s => s.buildInTools)
  const { notify } = useToastContext()

  // Construct the correct provider path for trigger plugins
  // Format should be: plugin_id/provider_name (e.g., "langgenius/github_trigger/github_trigger")
  const provider = useMemo(() => {
    if (data.type === BlockEnum.TriggerPlugin) {
      // If we have both plugin_id and provider_name, construct the full path
      if (data.provider_id && data.provider_name)
        return `${data.provider_id}/${data.provider_name}`

      // Otherwise use provider_id as fallback (might be already complete)
      return data.provider_id || ''
    }
    return data.provider_id || ''
  }, [data.type, data.provider_id, data.provider_name])

  // Always call hooks at the top level
  const { data: subscriptions = [] } = useTriggerSubscriptions(
    provider,
    data.type === BlockEnum.TriggerPlugin && !!provider,
  )
  const deleteSubscription = useDeleteTriggerSubscription()
  const initiateTriggerOAuth = useInitiateTriggerOAuth()
  const invalidateSubscriptions = useInvalidateTriggerSubscriptions()

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

  const handleConfigure = useCallback(async () => {
    if (!provider) return

    try {
      // 直接启动OAuth流程，后端会自动创建subscription builder
      const response = await initiateTriggerOAuth.mutateAsync(provider)
      if (response.authorization_url) {
        // 打开OAuth授权窗口
        const authWindow = window.open(response.authorization_url, 'oauth_authorization', 'width=600,height=600')

        // 监听窗口关闭，刷新订阅列表
        const checkClosed = setInterval(() => {
          if (authWindow?.closed) {
            clearInterval(checkClosed)
            invalidateSubscriptions(provider)
          }
        }, 1000)
      }
    }
    catch (error: any) {
      notify({
        type: 'error',
        message: `Failed to configure authentication: ${error.message}`,
      })
    }
  }, [provider, initiateTriggerOAuth, invalidateSubscriptions, notify])

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
