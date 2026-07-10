'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { RiAddCircleFill, RiArrowDownSLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import InstallFromGitHub from '@/app/components/plugins/install-plugin/install-from-github'
import InstallFromLocalPackage from '@/app/components/plugins/install-plugin/install-from-local-package'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import {
  GithubInstallSourceIcon,
  LocalPackageInstallSourceIcon,
  MarketplaceInstallSourceIcon,
} from './install-source-icons'

type Props = Readonly<{
  disabled?: boolean
  onSwitchToMarketplaceTab: () => void
  popupClassName?: string
  rootClassName?: string
  triggerClassName?: string
  triggerLabel?: string
  triggerOpenClassName?: string
  triggerVariant?: ButtonProps['variant']
  installContextCategory?: PluginCategoryEnum
  showTriggerArrow?: boolean
}>

type InstallMethod = {
  icon: React.ComponentType<{ className?: string }>
  text: string
  action: string
}

const InstallPluginDropdown = ({
  disabled = false,
  onSwitchToMarketplaceTab,
  popupClassName,
  rootClassName,
  triggerClassName,
  triggerLabel,
  triggerOpenClassName = 'bg-state-base-hover',
  triggerVariant,
  installContextCategory,
  showTriggerArrow = true,
}: Props) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const buttonLabel = triggerLabel ?? t($ => $['installPlugin'], { ns: 'plugin' })
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { data: plugin_installation_permission } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.plugin_installation_permission,
  })

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (disabled)
      return

    if (file) {
      setSelectedFile(file)
      setSelectedAction('local')
      setIsMenuOpen(false)
    }
  }

  const handleCloseLocalInstaller = () => {
    setSelectedAction(null)
    setSelectedFile(null)
    if (fileInputRef.current)
      fileInputRef.current.value = ''
  }

  // TODO TEST INSTALL : uninstall
  // const [pluginLists, setPluginLists] = useState<any>([])
  // useEffect(() => {
  //   (async () => {
  //     const list: any = await get('workspaces/current/plugin/list')
  //   })()
  // })

  // const handleUninstall = async (id: string) => {
  //   const res = await post('workspaces/current/plugin/uninstall', { body: { plugin_installation_id: id } })
  //   console.log(res)
  // }

  const installMethods = useMemo<InstallMethod[]>(() => {
    const methods: InstallMethod[] = []
    if (enable_marketplace)
      methods.push({ icon: MarketplaceInstallSourceIcon, text: t($ => $['source.marketplace'], { ns: 'plugin' }), action: 'marketplace' })

    if (plugin_installation_permission.restrict_to_marketplace_only)
      return methods

    methods.push({ icon: GithubInstallSourceIcon, text: t($ => $['source.github'], { ns: 'plugin' }), action: 'github' })
    methods.push({ icon: LocalPackageInstallSourceIcon, text: t($ => $['source.local'], { ns: 'plugin' }), action: 'local' })
    return methods
  }, [plugin_installation_permission, enable_marketplace, t])

  const handleInstallMethodSelect = (action: string) => {
    if (disabled)
      return

    if (action === 'local') {
      fileInputRef.current?.click()
      return
    }

    if (action === 'marketplace') {
      onSwitchToMarketplaceTab()
      return
    }

    queueMicrotask(() => {
      setSelectedAction(action)
    })
  }

  return (
    <DropdownMenu open={!disabled && isMenuOpen} onOpenChange={open => setIsMenuOpen(disabled ? false : open)} modal={false}>
      <div className={cn('relative', rootClassName)}>
        <input
          type="file"
          ref={fileInputRef}
          disabled={disabled}
          style={{ display: 'none' }}
          onChange={handleFileChange}
          accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
        />
        <DropdownMenuTrigger
          render={(
            <Button
              variant={triggerVariant}
              disabled={disabled}
              title={buttonLabel}
              aria-label={buttonLabel}
              className={cn(
                'size-full p-2',
                triggerClassName,
                !disabled && isMenuOpen && triggerOpenClassName,
              )}
            />
          )}
        >
          <>
            <RiAddCircleFill className="size-4 shrink-0" />
            <span className={cn(showTriggerArrow ? 'pl-1' : 'min-w-0 flex-1 px-0.5 text-left')}>
              {buttonLabel}
            </span>
            {showTriggerArrow && <RiArrowDownSLine className="ml-1 size-4" />}
          </>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName={cn('w-[200px] pb-2', popupClassName)}
        >
          <span className="flex items-start self-stretch px-3 pt-1 pb-0.5 system-xs-medium-uppercase text-text-tertiary">
            {t($ => $['installFrom'], { ns: 'plugin' })}
          </span>
          {installMethods.map(({ icon: Icon, text, action }) => (
            <DropdownMenuItem
              key={action}
              className="gap-1 px-2"
              onClick={() => handleInstallMethodSelect(action)}
            >
              <div className="flex items-center gap-1">
                <Icon className="size-4 text-text-tertiary" />
                <span className="px-1 system-md-regular text-text-secondary">{text}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </div>
      {selectedAction === 'github' && (
        <InstallFromGitHub
          installContextCategory={installContextCategory}
          onSuccess={noop}
          onClose={() => setSelectedAction(null)}
        />
      )}
      {
        selectedAction === 'local' && selectedFile
        && (
          <InstallFromLocalPackage
            file={selectedFile}
            installContextCategory={installContextCategory}
            onClose={handleCloseLocalInstaller}
            onSuccess={noop}
          />
        )
      }
      {/* {pluginLists.map((item: any) => (
        <div key={item.id} onClick={() => handleUninstall(item.id)}>{item.name} 卸载</div>
      ))} */}
    </DropdownMenu>
  )
}

export default InstallPluginDropdown
