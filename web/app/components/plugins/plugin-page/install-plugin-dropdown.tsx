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
            className={cn('text-components-button-secondary-text h-full w-full p-2', isMenuOpen && 'bg-state-base-hover')}
          >
            <RiAddLine className='h-4 w-4' />
            <span className='pl-1'>{t('plugin.installPlugin')}</span>
            <RiArrowDownSLine className='ml-1 h-4 w-4' />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='bg-components-panel-bg-blur border-components-panel-border shadows-shadow-lg flex w-[200px] flex-col items-start rounded-xl border p-1 pb-2'>
            <span className='text-text-tertiary system-xs-medium-uppercase flex items-start self-stretch pb-0.5 pl-2 pr-3 pt-1'>
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
                  className='hover:bg-state-base-hover flex w-full !cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5'
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
                  <Icon className="text-text-tertiary h-4 w-4" />
                  <span className='text-text-secondary system-md-regular px-1'>{text}</span>
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
