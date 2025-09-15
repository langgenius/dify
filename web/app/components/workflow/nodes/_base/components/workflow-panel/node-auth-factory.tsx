import type { FC } from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthorizedInNode } from '@/app/components/plugins/plugin-auth'
import { AuthCategory } from '@/app/components/plugins/plugin-auth'
import { BlockEnum, type Node } from '@/app/components/workflow/types'
import { canFindTool } from '@/utils'
import { useStore } from '@/app/components/workflow/store'
import AuthenticationMenu from '@/app/components/workflow/nodes/trigger-plugin/components/authentication-menu'
import {
  useDeleteTriggerSubscription,
  useInitiateTriggerOAuth,
  useInvalidateTriggerSubscriptions,
  useTriggerSubscriptions,
} from '@/service/use-triggers'
import { useToastContext } from '@/app/components/base/toast'
import { openOAuthPopup } from '@/hooks/use-oauth'

type NodeAuthProps = {
  data: Node['data']
  onAuthorizationChange: (credential_id: string) => void
  onSubscriptionChange?: (subscription_id: string) => void
}

const NodeAuth: FC<NodeAuthProps> = ({ data, onAuthorizationChange, onSubscriptionChange }) => {
  const { t } = useTranslation()
  const buildInTools = useStore(s => s.buildInTools)
  const { notify } = useToastContext()

  // Construct the correct provider path for trigger plugins
  // Format should be: plugin_id/provider_name (e.g., "langgenius/github_trigger/github_trigger")
  const provider = useMemo(() => {
    if (data.type === BlockEnum.TriggerPlugin) {
      // If we have both plugin_id and provider_name, construct the full path
      if (data.provider_name)
        return data.provider_name
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

  // Get selected subscription ID from node data
  const selectedSubscriptionId = data.subscription_id

  const handleConfigure = useCallback(async () => {
    if (!provider) return

    try {
      const response = await initiateTriggerOAuth.mutateAsync(provider)
      if (response.authorization_url) {
        openOAuthPopup(response.authorization_url, (callbackData) => {
          invalidateSubscriptions(provider)

          if (callbackData?.success === false) {
            notify({
              type: 'error',
              message: callbackData.errorDescription || callbackData.error || t('workflow.nodes.triggerPlugin.authenticationFailed'),
            })
          }
          else if (callbackData?.subscriptionId) {
            notify({
              type: 'success',
              message: t('workflow.nodes.triggerPlugin.authenticationSuccess'),
            })
          }
        })
      }
    }
    catch (error: any) {
      notify({
        type: 'error',
        message: `Failed to configure authentication: ${error.message}`,
      })
    }
  }, [provider, initiateTriggerOAuth, invalidateSubscriptions, notify])

  const handleRemove = useCallback(async (subscriptionId: string) => {
    if (!subscriptionId) return

    try {
      await deleteSubscription.mutateAsync(subscriptionId)
      // Clear subscription_id from node data
      if (onSubscriptionChange)
        onSubscriptionChange('')

      // Refresh subscriptions list
      invalidateSubscriptions(provider)

      notify({
        type: 'success',
        message: t('workflow.nodes.triggerPlugin.subscriptionRemoved'),
      })
    }
    catch (error: any) {
      notify({
        type: 'error',
        message: `Failed to remove subscription: ${error.message}`,
      })
    }
  }, [deleteSubscription, invalidateSubscriptions, notify, onSubscriptionChange, provider, t])

  const handleSubscriptionSelect = useCallback((subscriptionId: string) => {
    if (onSubscriptionChange)
      onSubscriptionChange(subscriptionId)
  }, [onSubscriptionChange])

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
        subscriptions={subscriptions}
        selectedSubscriptionId={selectedSubscriptionId}
        onSubscriptionSelect={handleSubscriptionSelect}
        onConfigure={handleConfigure}
        onRemove={handleRemove}
      />
    )
  }

  // No authentication needed
  return null
}

export default memo(NodeAuth)
