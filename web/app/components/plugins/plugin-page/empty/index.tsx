'use client'
import type { PluginPageContentInset } from '../content-inset'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Group } from '@/app/components/base/icons/src/vender/other'
import { FileZip } from '@/app/components/base/icons/src/vender/solid/files'
import { Github } from '@/app/components/base/icons/src/vender/solid/general'
import { MagicBox } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import InstallFromGitHub from '@/app/components/plugins/install-plugin/install-from-github'
import InstallFromLocalPackage from '@/app/components/plugins/install-plugin/install-from-local-package'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useInstalledPluginList } from '@/service/use-plugins'
import Line from '../../marketplace/empty/line'
import { pluginPageContentFrameClassNames, pluginPageContentInsetClassNames } from '../content-inset'
import { usePluginPageContext } from '../context'
import {
  DropHintInstallSourceIcon,
  GithubInstallSourceIcon,
  LocalPackageInstallSourceIcon,
  MarketplaceInstallSourceIcon,
} from '../install-source-icons'

type InstallMethod = {
  icon: React.ComponentType<{ className?: string }>
  integrationIcon: React.ComponentType
  text: string
  action: string
}

const TriggerEmptyIcon = () => (
  <span aria-hidden className="i-custom-vender-integrations-trigger-active size-6 shrink-0" />
)

const AgentStrategyEmptyIcon = () => (
  <span aria-hidden className="i-custom-vender-integrations-agent-strategy-active size-6 shrink-0" />
)

const ExtensionEmptyIcon = () => (
  <span aria-hidden className="i-custom-vender-integrations-extension-active size-6 shrink-0" />
)

type EmptyProps = {
  canInstall?: boolean
  contentInset?: PluginPageContentInset
  installContextCategory?: PluginCategoryEnum
  onSwitchToMarketplace?: () => void
  variant?: 'default' | 'integrationsAgentStrategy' | 'integrationsExtension' | 'integrationsTrigger'
}

const Empty = ({
  canInstall = true,
  contentInset = 'default',
  installContextCategory,
  onSwitchToMarketplace,
  variant = 'default',
}: EmptyProps) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { data: plugin_installation_permission } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.plugin_installation_permission,
  })
  const setActiveTab = usePluginPageContext(v => v.setActiveTab)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canInstall) {
      setSelectedFile(null)
      setSelectedAction(null)
      return
    }

    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setSelectedAction('local')
    }
  }
  const filters = usePluginPageContext(v => v.filters)
  const { data: pluginList } = useInstalledPluginList()

  const text = useMemo(() => {
    if (pluginList?.plugins.length === 0)
      return t('list.noInstalled', { ns: 'plugin' })
    if (filters.categories.length > 0 || filters.tags.length > 0 || filters.searchQuery)
      return t('list.notFound', { ns: 'plugin' })
  }, [pluginList?.plugins.length, t, filters.categories.length, filters.tags.length, filters.searchQuery])

  const installMethods = useMemo<InstallMethod[]>(() => {
    if (!canInstall)
      return []

    const methods: InstallMethod[] = []
    if (enable_marketplace)
      methods.push({ icon: MagicBox, integrationIcon: MarketplaceInstallSourceIcon, text: t('source.marketplace', { ns: 'plugin' }), action: 'marketplace' })

    if (plugin_installation_permission.restrict_to_marketplace_only)
      return methods

    methods.push({ icon: Github, integrationIcon: GithubInstallSourceIcon, text: t('source.github', { ns: 'plugin' }), action: 'github' })
    methods.push({ icon: FileZip, integrationIcon: LocalPackageInstallSourceIcon, text: t('source.local', { ns: 'plugin' }), action: 'local' })
    return methods
  }, [canInstall, plugin_installation_permission, enable_marketplace, t])
  const contentPaddingClassName = pluginPageContentInsetClassNames[contentInset]
  const canInstallLocalPackage = canInstall && !plugin_installation_permission.restrict_to_marketplace_only
  const isIntegrationsTrigger = variant === 'integrationsTrigger'
  const isIntegrationsAgentStrategy = variant === 'integrationsAgentStrategy'
  const isIntegrationsExtension = variant === 'integrationsExtension'
  const isIntegrationsCategory = isIntegrationsTrigger || isIntegrationsAgentStrategy || isIntegrationsExtension
  const supportsDropInstall = isIntegrationsCategory
  const showDropInstallTip = supportsDropInstall && canInstallLocalPackage
  const contentFrameClassName = cn(
    pluginPageContentFrameClassNames[contentInset],
    contentPaddingClassName,
  )
  const emptyText = isIntegrationsTrigger
    ? t('list.noTriggerFound', { ns: 'plugin' })
    : isIntegrationsAgentStrategy
      ? t('list.noAgentStrategyFound', { ns: 'plugin' })
      : isIntegrationsExtension
        ? t('list.noExtensionFound', { ns: 'plugin' })
        : text
  const placeholderItemCount = isIntegrationsCategory ? 14 : 20

  return (
    <div className="relative z-0 w-full grow bg-components-panel-bg">
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-0 left-1/2 z-10 grid h-full -translate-x-1/2 grid-cols-2 content-start gap-2 overflow-hidden',
          contentFrameClassName,
        )}
      >
        {Array.from({ length: placeholderItemCount }, (_, i) => (
          <div key={i} className={cn(isIntegrationsCategory ? 'h-24 rounded-lg bg-background-section-burn' : 'h-24 rounded-xl bg-components-card-bg')} />
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-20 bg-linear-to-b from-components-panel-bg-transparent to-components-panel-bg" />
      <div className={cn(
        'relative z-30 flex h-full',
        showDropInstallTip ? 'flex-col' : 'items-center justify-center',
      )}
      >
        <div
          className={cn(
            'flex items-center justify-center',
            showDropInstallTip ? 'min-h-0 flex-1' : 'h-full w-full',
          )}
        >
          <div className={cn(
            'flex flex-col items-center',
            isIntegrationsCategory ? 'gap-y-6' : 'gap-y-3',
          )}
          >
            <div className="flex flex-col items-center gap-y-3">
              <div className={cn(
                'relative -z-10 flex items-center justify-center border-dashed bg-components-card-bg backdrop-blur-md',
                isIntegrationsCategory
                  ? 'size-14 rounded-xl border border-divider-regular'
                  : 'size-14 rounded-xl border border-divider-deep shadow-xl shadow-shadow-shadow-5',
              )}
              >
                {isIntegrationsCategory
                  ? (
                      <span className="text-text-tertiary">
                        {isIntegrationsAgentStrategy
                          ? <AgentStrategyEmptyIcon />
                          : isIntegrationsExtension
                            ? <ExtensionEmptyIcon />
                            : <TriggerEmptyIcon />}
                      </span>
                    )
                  : <Group className="size-5 text-text-tertiary" />}
                {!isIntegrationsCategory && (
                  <>
                    <Line className="absolute top-1/2 -right-px -translate-y-1/2" />
                    <Line className="absolute top-1/2 -left-px -translate-y-1/2" />
                    <Line className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90" />
                    <Line className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90" />
                  </>
                )}
              </div>
              <div className={cn(isIntegrationsCategory ? 'system-sm-regular text-text-tertiary' : 'system-md-regular text-text-tertiary')}>
                {emptyText}
              </div>
            </div>
            <div className="flex w-[236px] flex-col">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
                accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
              />
              <div className="flex w-full flex-col gap-y-1">
                {installMethods.map(({ icon: Icon, integrationIcon: IntegrationIcon, text, action }) => (
                  <Button
                    key={action}
                    variant="secondary"
                    title={text}
                    className="h-8 w-full justify-start gap-x-0.5 px-3 py-2 system-sm-medium"
                    onClick={() => {
                      if (action === 'local')
                        fileInputRef.current?.click()
                      else if (action === 'marketplace')
                        onSwitchToMarketplace ? onSwitchToMarketplace() : setActiveTab('discover')
                      else
                        setSelectedAction(action)
                    }}
                  >
                    {isIntegrationsCategory
                      ? <IntegrationIcon />
                      : <Icon className="size-4 text-components-button-secondary-text" />}
                    <span className="min-w-0 flex-1 truncate px-0.5 text-left">{text}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {showDropInstallTip && (
          <div
            className="flex shrink-0 items-center justify-center gap-2 px-6 py-4 text-text-quaternary"
          >
            <DropHintInstallSourceIcon />
            <span className="system-xs-regular">{t('installModal.dropIntegrationToInstall', { ns: 'plugin' })}</span>
          </div>
        )}
        {selectedAction === 'github' && (
          <InstallFromGitHub
            installContextCategory={installContextCategory}
            onSuccess={noop}
            onClose={() => setSelectedAction(null)}
          />
        )}
        {selectedAction === 'local' && selectedFile
          && (
            <InstallFromLocalPackage
              file={selectedFile}
              installContextCategory={installContextCategory}
              onClose={() => setSelectedAction(null)}
              onSuccess={noop}
            />
          )}
      </div>
    </div>
  )
}

Empty.displayName = 'Empty'

export default React.memo(Empty)
