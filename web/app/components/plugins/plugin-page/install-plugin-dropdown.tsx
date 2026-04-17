'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { RiAddLine, RiArrowDownSLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileZip } from '@/app/components/base/icons/src/vender/solid/files'
import { Github } from '@/app/components/base/icons/src/vender/solid/general'
import { MagicBox } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { Button } from '@/app/components/base/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import InstallFromGitHub from '@/app/components/plugins/install-plugin/install-from-github'
import InstallFromLocalPackage from '@/app/components/plugins/install-plugin/install-from-local-package'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'

type Props = {
  onSwitchToMarketplaceTab: () => void
}

type InstallMethod = {
  icon: React.FC<{ className?: string }>
  text: string
  action: string
}

const InstallPluginDropdown = ({
  onSwitchToMarketplaceTab,
}: Props) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const { enable_marketplace, plugin_installation_permission } = useGlobalPublicStore(s => s.systemFeatures)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setSelectedAction('local')
      setIsMenuOpen(false)
    }
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

  const [installMethods, setInstallMethods] = useState<InstallMethod[]>([])
  useEffect(() => {
    const methods = []
    if (enable_marketplace)
      methods.push({ icon: MagicBox, text: t('source.marketplace', { ns: 'plugin' }), action: 'marketplace' })

    if (plugin_installation_permission.restrict_to_marketplace_only) {
      setInstallMethods(methods)
    }
    else {
      methods.push({ icon: Github, text: t('source.github', { ns: 'plugin' }), action: 'github' })
      methods.push({ icon: FileZip, text: t('source.local', { ns: 'plugin' }), action: 'local' })
      setInstallMethods(methods)
    }
  }, [plugin_installation_permission, enable_marketplace, t])

  const handleInstallMethodSelect = (action: string) => {
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
    <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <div className="relative">
        <DropdownMenuTrigger
          render={(
            <Button
              className={cn('h-full w-full p-2 text-components-button-secondary-text', isMenuOpen && 'bg-state-base-hover')}
            />
          )}
        >
          <>
            <RiAddLine className="h-4 w-4" />
            <span className="pl-1">{t('installPlugin', { ns: 'plugin' })}</span>
            <RiArrowDownSLine className="ml-1 h-4 w-4" />
          </>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="w-[200px] pb-2"
        >
          <span className="flex items-start self-stretch pt-1 pr-3 pb-0.5 pl-3 system-xs-medium-uppercase text-text-tertiary">
            {t('installFrom', { ns: 'plugin' })}
          </span>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
            accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
          />
          {installMethods.map(({ icon: Icon, text, action }) => (
            <DropdownMenuItem
              key={action}
              className="gap-1 px-2"
              onClick={() => handleInstallMethodSelect(action)}
            >
              <div className="flex items-center gap-1">
                <Icon className="h-4 w-4 text-text-tertiary" />
                <span className="px-1 system-md-regular text-text-secondary">{text}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </div>
      {selectedAction === 'github' && (
        <InstallFromGitHub
          onSuccess={noop}
          onClose={() => setSelectedAction(null)}
        />
      )}
      {selectedAction === 'local' && selectedFile
        && (
          <InstallFromLocalPackage
            file={selectedFile}
            onClose={() => setSelectedAction(null)}
            onSuccess={noop}
          />
        )}
      {/* {pluginLists.map((item: any) => (
        <div key={item.id} onClick={() => handleUninstall(item.id)}>{item.name} 卸载</div>
      ))} */}
    </DropdownMenu>
  )
}

export default InstallPluginDropdown
