'use client'

import type { SandboxProvider } from '@/service/use-sandbox-provider'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useGetSandboxProviderList } from '@/service/use-sandbox-provider'
import ConfigModal from './config-modal'
import ProviderCard from './provider-card'
import SwitchModal from './switch-modal'

const SandboxProviderPage = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceOwner } = useAppContext()
  const { data: providers, isLoading } = useGetSandboxProviderList()

  const [configModalProvider, setConfigModalProvider] = useState<SandboxProvider | null>(null)
  const [switchModalProvider, setSwitchModalProvider] = useState<SandboxProvider | null>(null)

  const currentProvider = providers?.find(p => p.is_active)
  const otherProviders = providers?.filter(p => !p.is_active) || []

  const handleConfig = (provider: SandboxProvider) => {
    setConfigModalProvider(provider)
  }

  const handleEnable = (provider: SandboxProvider) => {
    setSwitchModalProvider(provider)
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="system-sm-regular text-text-tertiary">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Provider Section */}
      {currentProvider && (
        <div>
          <div className="system-sm-semibold-uppercase mb-2 text-text-secondary">
            {t('sandboxProvider.currentProvider', { ns: 'common' })}
          </div>
          <ProviderCard
            provider={currentProvider}
            isCurrent
            onConfig={() => handleConfig(currentProvider)}
            disabled={!isCurrentWorkspaceOwner}
          />
        </div>
      )}

      {/* Other Providers Section */}
      {otherProviders.length > 0 && (
        <div>
          <div className="system-sm-semibold-uppercase mb-2 text-text-secondary">
            {t('sandboxProvider.otherProvider', { ns: 'common' })}
          </div>
          <div className="space-y-2">
            {otherProviders.map(provider => (
              <ProviderCard
                key={provider.provider_type}
                provider={provider}
                onConfig={() => handleConfig(provider)}
                onEnable={() => handleEnable(provider)}
                disabled={!isCurrentWorkspaceOwner}
              />
            ))}
          </div>
        </div>
      )}

      {!isCurrentWorkspaceOwner && (
        <div className="system-xs-regular text-text-tertiary">
          {t('sandboxProvider.noPermission', { ns: 'common' })}
        </div>
      )}

      {/* Config Modal */}
      {configModalProvider && (
        <ConfigModal
          provider={configModalProvider}
          onClose={() => setConfigModalProvider(null)}
        />
      )}

      {/* Switch Modal */}
      {switchModalProvider && (
        <SwitchModal
          provider={switchModalProvider}
          onClose={() => setSwitchModalProvider(null)}
        />
      )}
    </div>
  )
}

export default memo(SandboxProviderPage)
