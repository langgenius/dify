import React, { useMemo, useRef, useState } from 'react'
import { MagicBox } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { FileZip } from '@/app/components/base/icons/src/vender/solid/files'
import { Github } from '@/app/components/base/icons/src/vender/solid/general'
import InstallFromGitHub from '@/app/components/plugins/install-plugin/install-from-github'
import InstallFromLocalPackage from '@/app/components/plugins/install-plugin/install-from-local-package'
import { usePluginPageContext } from '../context'
import { Group } from '@/app/components/base/icons/src/vender/other'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import Line from '../../marketplace/empty/line'
import { useInstalledPluginList } from '@/service/use-plugins'
import { useTranslation } from 'react-i18next'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'

const Empty = () => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const { enable_marketplace } = useAppContextSelector(s => s.systemFeatures)
  const setActiveTab = usePluginPageContext(v => v.setActiveTab)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      return t('plugin.list.noInstalled')
    if (filters.categories.length > 0 || filters.tags.length > 0 || filters.searchQuery)
      return t('plugin.list.notFound')
  }, [pluginList?.plugins.length, t, filters.categories.length, filters.tags.length, filters.searchQuery])

  return (
    <div className='relative z-0 w-full grow'>
      {/* skeleton */}
      <div className='absolute top-0 z-10 grid h-full w-full grid-cols-2 gap-2 overflow-hidden px-12'>
        {Array.from({ length: 20 }).fill(0).map((_, i) => (
          <div key={i} className='bg-components-card-bg h-[100px] rounded-xl' />
        ))}
      </div>
      {/* mask */}
      <div className='from-background-gradient-mask-transparent absolute z-20 h-full w-full bg-gradient-to-b to-white' />
      <div className='relative z-30 flex h-full items-center justify-center'>
        <div className='flex flex-col items-center gap-y-3'>
          <div className='bg-components-card-bg border-divider-deep shadow-shadow-shadow-5 relative -z-10 flex h-[52px] w-[52px]
          items-center justify-center rounded-xl border-[1px] border-dashed shadow-xl'>
            <Group className='text-text-tertiary h-5 w-5' />
            <Line className='absolute -right-[1px] top-1/2 -translate-y-1/2' />
            <Line className='absolute -left-[1px] top-1/2 -translate-y-1/2' />
            <Line className='absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rotate-90' />
            <Line className='absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 rotate-90' />
          </div>
          <div className='text-text-tertiary text-sm font-normal'>
            {text}
          </div>
          <div className='flex w-[240px] flex-col'>
            <input
              type='file'
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
              accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
            />
            <div className='flex w-full flex-col gap-y-1'>
              {[
                ...(
                  (enable_marketplace || true)
                    ? [{ icon: MagicBox, text: t('plugin.list.source.marketplace'), action: 'marketplace' }]
                    : []
                ),
                { icon: Github, text: t('plugin.list.source.github'), action: 'github' },
                { icon: FileZip, text: t('plugin.list.source.local'), action: 'local' },
              ].map(({ icon: Icon, text, action }) => (
                <div
                  key={action}
                  className='bg-components-button-secondary-bg hover:bg-state-base-hover shadow-shadow-shadow-3 shadow-xs flex cursor-pointer items-center
                  gap-x-1 rounded-lg border-[0.5px] px-3 py-2'
                  onClick={() => {
                    if (action === 'local')
                      fileInputRef.current?.click()
                    else if (action === 'marketplace')
                      setActiveTab('discover')
                    else
                      setSelectedAction(action)
                  }}
                >
                  <Icon className="text-text-tertiary h-4 w-4" />
                  <span className='text-text-secondary system-md-regular'>{text}</span>
                </div>
              ))}
            </div>
          </div>
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
      </div>
    </div>
  )
}

Empty.displayName = 'Empty'

export default React.memo(Empty)
