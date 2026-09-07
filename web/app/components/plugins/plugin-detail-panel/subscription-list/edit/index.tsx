'use client'
import type { PluginDetail } from '@/app/components/plugins/types'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { ApiKeyEditModal } from './apikey-edit-modal'
import { ManualEditModal } from './manual-edit-modal'
import { OAuthEditModal } from './oauth-edit-modal'

type Props = Readonly<{
  onClose: () => void
  subscription: TriggerSubscription
  pluginDetail?: PluginDetail
}>

export const EditModal = ({ onClose, subscription, pluginDetail }: Props) => {
  const credentialType = subscription.credential_type

  switch (credentialType) {
    case TriggerCredentialType.Unauthorized:
      return (
        <ManualEditModal
          onClose={onClose}
          subscription={subscription}
          pluginDetail={pluginDetail}
        />
      )
    case TriggerCredentialType.Oauth2:
      return (
        <OAuthEditModal onClose={onClose} subscription={subscription} pluginDetail={pluginDetail} />
      )
    case TriggerCredentialType.ApiKey:
      return (
        <ApiKeyEditModal
          onClose={onClose}
          subscription={subscription}
          pluginDetail={pluginDetail}
        />
      )
    default:
      return null
  }
}
