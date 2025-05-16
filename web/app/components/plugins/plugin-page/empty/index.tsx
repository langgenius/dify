import React, { useMemo, useRef, useState } from 'react'
import { MagicBox } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { FileZip } from '@/app/components/base/icons/src/vender/solid/files'
import { Github } from '@/app/components/base/icons/src/vender/solid/general'
import InstallFromGitHub from '@/app/components/plugins/install-plugin/install-from-github'
import InstallFromLocalPackage from '@/app/components/plugins/install-plugin/install-from-local-package'
import { usePluginPageContext } from '../context'
import { Group } from '@/app/components/base/icons/src/vender/other'
import Line from '../../marketplace/empty/line'
import { useInstalledPluginList } from '@/service/use-plugins'
import { useTranslation } from 'react-i18next'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { noop } from 'lodash-es'
import { useGlobalPublicStore } from '@/context/global-public-context'

const Empty = () => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
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
          <div key={i} className='h-[100px] rounded-xl bg-components-card-bg' />
        ))}
      </div>
      {/* mask */}
      <div className='absolute z-20 h-full w-full bg-gradient-to-b from-components-panel-bg-transparent to-components-panel-bg' />
      <div className='relative z-30 flex h-full items-center justify-center'>
        <div className='flex flex-col items-center gap-y-3'>
          <div className='relative -z-10 flex h-[52px] w-[52px] items-center justify-center rounded-xl
          border-[1px] border-dashed border-divider-deep bg-components-card-bg shadow-xl shadow-shadow-shadow-5'>
            <Group className='h-5 w-5 text-text-tertiary' />
            <Line className='absolute right-[-1px] top-1/2 -translate-y-1/2' />
            <Line className='absolute left-[-1px] top-1/2 -translate-y-1/2' />
            <Line className='absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rotate-90' />
            <Line className='absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 rotate-90' />
          </div>
          <div className='text-sm font-normal text-text-tertiary'>
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
                  (enable_marketplace)
                    ? [{ icon: MagicBox, text: t('plugin.list.source.marketplace'), action: 'marketplace' }]
                    : []
                ),
                { icon: Github, text: t('plugin.list.source.github'), action: 'github' },
                { icon: FileZip, text: t('plugin.list.source.local'), action: 'local' },
              ].map(({ icon: Icon, text, action }) => (
                <div
                  key={action}
                  className='flex cursor-pointer items-center gap-x-1 rounded-lg border-[0.5px] bg-components-button-secondary-bg
                  px-3 py-2 shadow-xs shadow-shadow-shadow-3 hover:bg-state-base-hover'
                  onClick={() => {
                    if (action === 'local')
                      fileInputRef.current?.click()
                    else if (action === 'marketplace')
                      setActiveTab('discover')
                    else
                      setSelectedAction(action)
                  }}
                >
                  <Icon className="h-4 w-4 text-text-tertiary" />
                  <span className='system-md-regular text-text-secondary'>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {selectedAction === 'github' && <InstallFromGitHub
          onSuccess={noop}
          onClose={() => setSelectedAction(null)}
        />}
        {selectedAction === 'local' && selectedFile
          && (<InstallFromLocalPackage
            file={selectedFile}
            onClose={() => setSelectedAction(null)}
            onSuccess={noop}
          />
          )
        }
      </div>
    </div>
  )
}

Empty.displayName = 'Empty'

export default React.memo(Empty)
