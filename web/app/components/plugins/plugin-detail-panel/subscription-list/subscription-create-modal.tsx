'use client'
import React from 'react'
import { ManualCreateModal } from './create/manual-create-modal'
import { ApiKeyCreateModal } from './create/api-key-create-modal'
import { OAuthCreateModal } from './create/oauth-create-modal'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import type { TriggerOAuthConfig } from '@/app/components/workflow/block-selector/types'

type Props = {
  type: SupportedCreationMethods
  oauthConfig?: TriggerOAuthConfig
  onClose: () => void
  onSuccess: () => void
}

export const SubscriptionCreateModal = ({ type, oauthConfig, onClose, onSuccess }: Props) => {
  const renderModalContent = () => {
    switch (type) {
      case SupportedCreationMethods.MANUAL:
        return (
          <ManualCreateModal
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )
      case SupportedCreationMethods.APIKEY:
        return (
          <ApiKeyCreateModal
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )
      case SupportedCreationMethods.OAUTH:
        return (
          <OAuthCreateModal
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
