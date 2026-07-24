'use client'
import type { PluginDetail } from '@/app/components/plugins/types'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { ApiKeyEditModal } from './apikey-edit-modal'
import { ManualEditModal } from './manual-edit-modal'
import { OAuthEditModal } from './oauth-edit-modal'

type Props = {
  onClose: () => void
  subscription: TriggerSubscription
  pluginDetail?: PluginDetail
}

export const EditModal = ({ onClose, subscription, pluginDetail }: Props) => {
  const credentialType = subscription.credential_type

  switch (credentialType) {
    case TriggerCredentialTypeEnum.Unauthorized:
      return <ManualEditModal onClose={onClose} subscription={subscription} pluginDetail={pluginDetail} />
    case TriggerCredentialTypeEnum.Oauth2:
      return <OAuthEditModal onClose={onClose} subscription={subscription} pluginDetail={pluginDetail} />
    case TriggerCredentialTypeEnum.ApiKey:
      return <ApiKeyEditModal onClose={onClose} subscription={subscription} pluginDetail={pluginDetail} />
    default:
      return null
  }
}
