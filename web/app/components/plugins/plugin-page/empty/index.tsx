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
import {
  pluginPageContentFrameClassNames,
  pluginPageContentInsetClassNames,
} from '../content-inset'
import { usePluginPageContext } from '../context'

type InstallMethod = {
  icon: React.ComponentType<{ className?: string }>
  text: string
  action: string
}

type EmptyProps = {
  canInstall?: boolean
  contentInset?: PluginPageContentInset
  installContextCategory?: PluginCategoryEnum
  onSwitchToMarketplace?: () => void
}

const Empty = ({
  canInstall = true,
  contentInset = 'default',
  installContextCategory,
  onSwitchToMarketplace,
}: EmptyProps) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_marketplace,
  })
  const { data: plugin_installation_permission } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.plugin_installation_permission,
  })
  const setActiveTab = usePluginPageContext((v) => v.setActiveTab)

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
  const filters = usePluginPageContext((v) => v.filters)
  const { data: pluginList } = useInstalledPluginList()

  const text = useMemo(() => {
    if (pluginList?.plugins.length === 0) return t(($) => $['list.noInstalled'], { ns: 'plugin' })
    if (filters.categories.length > 0 || filters.tags.length > 0 || filters.searchQuery)
      return t(($) => $['list.notFound'], { ns: 'plugin' })
  }, [
    pluginList?.plugins.length,
    t,
    filters.categories.length,
    filters.tags.length,
    filters.searchQuery,
  ])

  const installMethods = useMemo<InstallMethod[]>(() => {
    if (!canInstall) return []

    const methods: InstallMethod[] = []
    if (enable_marketplace)
      methods.push({
        icon: MagicBox,
        text: t(($) => $['source.marketplace'], { ns: 'plugin' }),
        action: 'marketplace',
      })

    if (plugin_installation_permission.restrict_to_marketplace_only) return methods

    methods.push({
      icon: Github,
      text: t(($) => $['source.github'], { ns: 'plugin' }),
      action: 'github',
    })
    methods.push({
      icon: FileZip,
      text: t(($) => $['source.local'], { ns: 'plugin' }),
      action: 'local',
    })
    return methods
  }, [canInstall, plugin_installation_permission, enable_marketplace, t])
  const contentPaddingClassName = pluginPageContentInsetClassNames[contentInset]
  const contentFrameClassName = cn(
    pluginPageContentFrameClassNames[contentInset],
    contentPaddingClassName,
  )

  return (
    <div className="relative z-0 w-full grow bg-components-panel-bg">
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-0 left-1/2 z-10 grid h-full -translate-x-1/2 grid-cols-2 content-start gap-2 overflow-hidden',
          contentFrameClassName,
        )}
      >
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl bg-components-card-bg" />
        ))}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 bg-linear-to-b from-components-panel-bg-transparent to-components-panel-bg"
      />
      <div className="relative z-30 flex h-full items-center justify-center">
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-y-3">
            <div className="flex flex-col items-center gap-y-3">
              <div className="relative -z-10 flex size-14 items-center justify-center rounded-xl border border-dashed border-divider-deep bg-components-card-bg shadow-xl shadow-shadow-shadow-5 backdrop-blur-md">
                <Group className="size-5 text-text-tertiary" />
                <Line className="absolute top-1/2 -right-px -translate-y-1/2" />
                <Line className="absolute top-1/2 -left-px -translate-y-1/2" />
                <Line className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90" />
                <Line className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90" />
              </div>
              <div className="system-md-regular text-text-tertiary">{text}</div>
            </div>
            <div className="flex w-59 flex-col">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
                accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
              />
              <div className="flex w-full flex-col gap-y-1">
                {installMethods.map(({ icon: Icon, text, action }) => (
                  <Button
                    key={action}
                    variant="secondary"
                    title={text}
                    className="h-8 w-full justify-start py-2 system-sm-medium"
                    onClick={() => {
                      if (action === 'local') fileInputRef.current?.click()
                      else if (action === 'marketplace')
                        onSwitchToMarketplace ? onSwitchToMarketplace() : setActiveTab('discover')
                      else setSelectedAction(action)
                    }}
                  >
                    <Icon className="size-4 text-components-button-secondary-text" />
                    <span className="min-w-0 flex-1 truncate text-left">{text}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {selectedAction === 'github' && (
          <InstallFromGitHub
            installContextCategory={installContextCategory}
            onSuccess={noop}
            onClose={() => setSelectedAction(null)}
          />
        )}
        {selectedAction === 'local' && selectedFile && (
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
