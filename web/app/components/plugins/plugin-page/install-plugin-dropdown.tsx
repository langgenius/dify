'use client'

import { RiAddLine, RiArrowDownSLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { FileZip } from '@/app/components/base/icons/src/vender/solid/files'
import { Github } from '@/app/components/base/icons/src/vender/solid/general'
import { MagicBox } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import InstallFromGitHub from '@/app/components/plugins/install-plugin/install-from-github'
import InstallFromLocalPackage from '@/app/components/plugins/install-plugin/install-from-local-package'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { cn } from '@/utils/classnames'

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

  return (
    <PortalToFollowElem
      open={isMenuOpen}
      onOpenChange={setIsMenuOpen}
      placement="bottom-start"
      offset={4}
    >
      <div className="relative">
        <PortalToFollowElemTrigger onClick={() => setIsMenuOpen(v => !v)}>
          <Button
            className={cn('h-full w-full p-2 text-components-button-secondary-text', isMenuOpen && 'bg-state-base-hover')}
          >
            <RiAddLine className="h-4 w-4" />
            <span className="pl-1">{t('installPlugin', { ns: 'plugin' })}</span>
            <RiArrowDownSLine className="ml-1 h-4 w-4" />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[1002]">
          <div className="shadows-shadow-lg flex w-[200px] flex-col items-start rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-1 pb-2">
            <span className="system-xs-medium-uppercase flex items-start self-stretch pb-0.5 pl-2 pr-3 pt-1 text-text-tertiary">
              {t('installFrom', { ns: 'plugin' })}
            </span>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
              accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
            />
            <div className="w-full">
              {installMethods.map(({ icon: Icon, text, action }) => (
                <div
                  key={action}
                  className="flex w-full !cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
                  onClick={() => {
                    if (action === 'local') {
                      fileInputRef.current?.click()
                    }
                    else if (action === 'marketplace') {
                      onSwitchToMarketplaceTab()
                      setIsMenuOpen(false)
                    }
                    else {
                      setSelectedAction(action)
                      setIsMenuOpen(false)
                    }
                  }}
                >
                  <Icon className="h-4 w-4 text-text-tertiary" />
                  <span className="system-md-regular px-1 text-text-secondary">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </PortalToFollowElemContent>
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
    </PortalToFollowElem>
  )
}

export default InstallPluginDropdown
