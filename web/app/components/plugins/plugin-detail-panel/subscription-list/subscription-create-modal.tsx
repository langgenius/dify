'use client'
import React from 'react'
// import { useTranslation } from 'react-i18next'
// import Modal from '@/app/components/base/modal'
import { ManualCreateModal } from './manual-create-modal'
import { ApiKeyCreateModal } from './api-key-create-modal'
import { OAuthCreateModal } from './oauth-create-modal'
import type { PluginDetail } from '@/app/components/plugins/types'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import type { TriggerOAuthConfig } from '@/app/components/workflow/block-selector/types'

type Props = {
  type: SupportedCreationMethods
  pluginDetail: PluginDetail
  oauthConfig?: TriggerOAuthConfig
  onClose: () => void
  onSuccess: () => void
}

export const SubscriptionCreateModal = ({ type, pluginDetail, oauthConfig, onClose, onSuccess }: Props) => {
  // const { t } = useTranslation()

  const renderModalContent = () => {
    switch (type) {
      case SupportedCreationMethods.MANUAL:
        return (
          <ManualCreateModal
            pluginDetail={pluginDetail}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )
      case SupportedCreationMethods.APIKEY:
        return (
          <ApiKeyCreateModal
            pluginDetail={pluginDetail}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )
      case SupportedCreationMethods.OAUTH:
        return (
          <OAuthCreateModal
            pluginDetail={pluginDetail}
            oauthConfig={oauthConfig}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )
      default:
        return null
    }
  }

  return renderModalContent()
}
