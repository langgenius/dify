'use client'
import React from 'react'
// import { useTranslation } from 'react-i18next'
// import Modal from '@/app/components/base/modal'
import ManualAddModal from './manual-add-modal'
import ApiKeyAddModal from './api-key-add-modal'
import OAuthAddModal from './oauth-add-modal'
import type { PluginDetail } from '@/app/components/plugins/types'

type SubscriptionAddType = 'api-key' | 'oauth' | 'manual'

type Props = {
  type: SubscriptionAddType
  pluginDetail: PluginDetail
  onClose: () => void
  onSuccess: () => void
}

const SubscriptionAddModal = ({ type, pluginDetail, onClose, onSuccess }: Props) => {
  // const { t } = useTranslation()

  const renderModalContent = () => {
    switch (type) {
      case 'manual':
        return (
          <ManualAddModal
            pluginDetail={pluginDetail}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )
      case 'api-key':
        return (
          <ApiKeyAddModal
            pluginDetail={pluginDetail}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )
      case 'oauth':
        return (
          <OAuthAddModal
            pluginDetail={pluginDetail}
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

export default SubscriptionAddModal
