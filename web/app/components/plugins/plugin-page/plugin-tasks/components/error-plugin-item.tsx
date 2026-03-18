import type { FC } from 'react'
import type { Plugin, PluginStatus } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { PluginSource } from '@/app/components/plugins/types'
import { fetchPluginInfoFromMarketPlace } from '@/service/plugins'
import PluginItem from './plugin-item'

type ErrorPluginItemProps = {
  plugin: PluginStatus
  getIconUrl: (icon: string) => string
  language: Locale
  onClear: () => void
}

const ErrorPluginItem: FC<ErrorPluginItemProps> = ({ plugin, getIconUrl, language, onClear }) => {
  const { t } = useTranslation()
  const source = plugin.source
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [installPayload, setInstallPayload] = useState<{ uniqueIdentifier: string, manifest: Plugin } | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  const handleInstallFromMarketplace = useCallback(async () => {
    const parts = plugin.plugin_id.split('/')
    if (parts.length < 2)
      return
    const [org, name] = parts
    setIsFetching(true)
    try {
      const response = await fetchPluginInfoFromMarketPlace({ org, name })
      const info = response.data.plugin
      const manifest: Plugin = {
        plugin_id: plugin.plugin_id,
        type: info.category as Plugin['type'],
        category: info.category,
        name,
        org,
        version: info.latest_version,
        latest_version: info.latest_version,
        latest_package_identifier: info.latest_package_identifier,
        label: plugin.labels,
        brief: {},
        description: {},
        icon: plugin.icon,
        verified: true,
        introduction: '',
        repository: '',
        install_count: 0,
        endpoint: { settings: [] },
        tags: [],
        badges: [],
        verification: { authorized_category: 'langgenius' },
        from: 'marketplace',
      }
      setInstallPayload({ uniqueIdentifier: info.latest_package_identifier, manifest })
      setShowInstallModal(true)
    }
    catch {
      // silently fail
    }
    finally {
      setIsFetching(false)
    }
  }, [plugin.plugin_id, plugin.labels, plugin.icon])

  const errorMsgKey: 'task.errorMsg.marketplace' | 'task.errorMsg.github' | 'task.errorMsg.unknown' = source === PluginSource.marketplace
    ? 'task.errorMsg.marketplace'
    : source === PluginSource.github
      ? 'task.errorMsg.github'
      : 'task.errorMsg.unknown'

  const errorMsg = t(errorMsgKey, { ns: 'plugin' })

  const renderAction = () => {
    if (source === PluginSource.marketplace) {
      return (
        <div className="pt-1">
          <Button variant="secondary" size="small" loading={isFetching} onClick={handleInstallFromMarketplace}>
            {t('task.installFromMarketplace', { ns: 'plugin' })}
          </Button>
        </div>
      )
    }
    if (source === PluginSource.github) {
      return (
        <div className="pt-1">
          <Button variant="secondary" size="small">
            {t('task.installFromGithub', { ns: 'plugin' })}
          </Button>
        </div>
      )
    }
    return undefined
  }

  return (
    <>
      <PluginItem
        plugin={plugin}
        getIconUrl={getIconUrl}
        language={language}
        statusIcon={(
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-components-panel-bg bg-components-panel-bg">
            <span className="i-ri-error-warning-fill h-4 w-4 text-text-destructive" />
          </span>
        )}
        statusText={(
          <span className="whitespace-pre-line">
            {plugin.message || errorMsg}
          </span>
        )}
        statusClassName="text-text-destructive"
        action={renderAction()}
        onClear={onClear}
      />
      {showInstallModal && installPayload && (
        <InstallFromMarketplace
          uniqueIdentifier={installPayload.uniqueIdentifier}
          manifest={installPayload.manifest}
          onClose={() => setShowInstallModal(false)}
          onSuccess={() => {
            setShowInstallModal(false)
            onClear()
          }}
        />
      )}
    </>
  )
}

export default ErrorPluginItem
