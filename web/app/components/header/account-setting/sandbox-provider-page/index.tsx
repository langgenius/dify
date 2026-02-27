'use client'

import type { SandboxProvider } from '@/types/sandbox-provider'
import { useQuery } from '@tanstack/react-query'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { consoleQuery } from '@/service/client'
import ConfigModal from './config-modal'
import ProviderCard from './provider-card'
import SwitchModal from './switch-modal'

const SandboxProviderPage = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager, isLoadingCurrentWorkspace } = useAppContext()
  const { data: providers, isLoading } = useQuery(consoleQuery.sandboxProvider.getSandboxProviderList.queryOptions())

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
        <Loading />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Provider Section */}
      {currentProvider && (
        <div>
          <div className="mb-2 text-text-secondary system-sm-semibold-uppercase">
            {t('sandboxProvider.currentProvider', { ns: 'common' })}
          </div>
          <ProviderCard
            provider={currentProvider}
            isCurrent
            onConfig={() => handleConfig(currentProvider)}
            disabled={!isCurrentWorkspaceManager}
          />
        </div>
      )}

      {/* Other Providers Section */}
      {otherProviders.length > 0 && (
        <div>
          <div className="mb-2 text-text-secondary system-sm-semibold-uppercase">
            {t('sandboxProvider.otherProvider', { ns: 'common' })}
          </div>
          <div className="space-y-2">
            {otherProviders.map(provider => (
              <ProviderCard
                key={provider.provider_type}
                provider={provider}
                onConfig={() => handleConfig(provider)}
                onEnable={() => handleEnable(provider)}
                disabled={!isCurrentWorkspaceManager}
              />
            ))}
          </div>
        </div>
      )}

      {!isLoadingCurrentWorkspace && !isCurrentWorkspaceManager && (
        <div className="text-text-tertiary system-xs-regular">
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
