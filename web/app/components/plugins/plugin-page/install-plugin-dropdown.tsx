'use client'

import { useRef, useState } from 'react'
import { RiAddLine, RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { MagicBox } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { FileZip } from '@/app/components/base/icons/src/vender/solid/files'
import { Github } from '@/app/components/base/icons/src/vender/solid/general'
import InstallFromGitHub from '@/app/components/plugins/install-plugin/install-from-github'
import InstallFromLocalPackage from '@/app/components/plugins/install-plugin/install-from-local-package'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { useTranslation } from 'react-i18next'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'

type Props = {
  onSwitchToMarketplaceTab: () => void
}
const InstallPluginDropdown = ({
  onSwitchToMarketplaceTab,
}: Props) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const { enable_marketplace } = useAppContextSelector(s => s.systemFeatures)

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

  return (
    <PortalToFollowElem
      open={isMenuOpen}
      onOpenChange={setIsMenuOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className="relative">
        <PortalToFollowElemTrigger onClick={() => setIsMenuOpen(v => !v)}>
          <Button
            className={cn('w-full h-full p-2 text-components-button-secondary-text', isMenuOpen && 'bg-state-base-hover')}
          >
            <RiAddLine className='w-4 h-4' />
            <span className='pl-1'>{t('plugin.installPlugin')}</span>
            <RiArrowDownSLine className='w-4 h-4 ml-1' />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='flex flex-col p-1 pb-2 items-start w-[200px] bg-components-panel-bg-blur border border-components-panel-border rounded-xl shadows-shadow-lg'>
            <span className='flex pt-1 pb-0.5 pl-2 pr-3 items-start self-stretch text-text-tertiary system-xs-medium-uppercase'>
              {t('plugin.installFrom')}
            </span>
            <input
              type='file'
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
              accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
            />
            <div className='w-full'>
              {[
                ...(
                  (enable_marketplace || true)
                    ? [{ icon: MagicBox, text: t('plugin.source.marketplace'), action: 'marketplace' }]
                    : []
                ),
                { icon: Github, text: t('plugin.source.github'), action: 'github' },
                { icon: FileZip, text: t('plugin.source.local'), action: 'local' },
              ].map(({ icon: Icon, text, action }) => (
                <div
                  key={action}
                  className='flex items-center w-full px-2 py-1.5 gap-1 rounded-lg hover:bg-state-base-hover !cursor-pointer'
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
                  <Icon className="w-4 h-4 text-text-tertiary" />
                  <span className='px-1 text-text-secondary system-md-regular'>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </PortalToFollowElemContent>
      </div>
      {selectedAction === 'github' && <InstallFromGitHub
        onSuccess={() => { }}
        onClose={() => setSelectedAction(null)}
      />}
      {selectedAction === 'local' && selectedFile
        && (<InstallFromLocalPackage
          file={selectedFile}
          onClose={() => setSelectedAction(null)}
          onSuccess={() => { }}
        />
        )
      }
      {/* {pluginLists.map((item: any) => (
        <div key={item.id} onClick={() => handleUninstall(item.id)}>{item.name} 卸载</div>
      ))} */}
    </PortalToFollowElem>
  )
}

export default InstallPluginDropdown
