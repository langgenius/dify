'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDragDropLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import InstallFromLocalPackage from '../install-plugin/install-from-local-package'
import {
  PluginPageContextProvider,
  usePluginPageContext,
} from './context'
import InstallPluginDropdown from './install-plugin-dropdown'
import { useUploader } from './use-uploader'
import usePermission from './use-permission'
import DebugInfo from './debug-info'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import Button from '@/app/components/base/button'
import TabSlider from '@/app/components/base/tab-slider'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import PermissionSetModal from '@/app/components/plugins/permission-setting-modal/modal'

export type PluginPageProps = {
  plugins: React.ReactNode
  marketplace: React.ReactNode
}
const PluginPage = ({
  plugins,
  marketplace,
}: PluginPageProps) => {
  const { t } = useTranslation()
  const {
    canManagement,
    canDebugger,
    canSetPermissions,
    permissions,
    setPermissions,
  } = usePermission()
  const [showPluginSettingModal, {
    setTrue: setShowPluginSettingModal,
    setFalse: setHidePluginSettingModal,
  }] = useBoolean()
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const containerRef = usePluginPageContext(v => v.containerRef)
  const options = useMemo(() => {
    return [
      { value: 'plugins', text: t('common.menus.plugins') },
      { value: 'discover', text: 'Explore Marketplace' },
    ]
  }, [t])
  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: options[0].value,
  })

  const uploaderProps = useUploader({
    onFileChange: setCurrentFile,
    containerRef,
    enabled: activeTab === 'plugins',
  })

  const { dragging, fileUploader, fileChangeHandle, removeFile } = uploaderProps

  return (
    <div
      ref={containerRef}
      className={cn('grow relative flex flex-col overflow-y-auto border-t border-divider-subtle', activeTab === 'plugins'
        ? 'rounded-t-xl bg-components-panel-bg'
        : 'bg-background-body',
      )}
    >
      <div
        className={cn(
          'sticky top-0 flex min-h-[60px] px-12 pt-4 pb-2 items-center self-stretch gap-1 z-10', activeTab === 'discover' && 'bg-background-body',
        )}
      >
        <div className='flex justify-between items-center w-full'>
          <div className='flex-1'>
            <TabSlider
              value={activeTab}
              onChange={setActiveTab}
              options={options}
            />
          </div>
          <div className='flex flex-shrink-0 items-center gap-1'>
            {canManagement && (
              <InstallPluginDropdown />
            )}
            {
              canDebugger && (
                <DebugInfo />
              )
            }
            {
              canSetPermissions && (
                <Tooltip
                  popupContent={t('plugin.privilege.title')}
                >
                  <Button
                    className='w-full h-full p-2 text-components-button-secondary-text group'
                    onClick={setShowPluginSettingModal}
                  >
                    <RiEqualizer2Line className='w-4 h-4' />
                  </Button>
                </Tooltip>
              )
            }
          </div>
        </div>
      </div>
      {activeTab === 'plugins' && (
        <>
          {plugins}
          {dragging && (
            <div
              className="absolute inset-0 m-0.5 p-2 rounded-2xl bg-[rgba(21,90,239,0.14)] border-2
                  border-dashed border-components-dropzone-border-accent">
            </div>
          )}
          <div className={`flex py-4 justify-center items-center gap-2 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}>
            <RiDragDropLine className="w-4 h-4" />
            <span className="system-xs-regular">Drop plugin package here to install</span>
          </div>
          {currentFile && (
            <InstallFromLocalPackage file={currentFile} onClose={removeFile ?? (() => { })} />
          )}
          <input
            ref={fileUploader}
            className="hidden"
            type="file"
            id="fileUploader"
            accept='.difypkg'
            onChange={fileChangeHandle ?? (() => { })}
          />
        </>
      )}
      {
        activeTab === 'discover' && marketplace
      }

      {showPluginSettingModal && (
        <PermissionSetModal
          payload={permissions}
          onHide={setHidePluginSettingModal}
          onSave={setPermissions}
        />
      )}
    </div>
  )
}

const PluginPageWithContext = (props: PluginPageProps) => {
  return (
    <PluginPageContextProvider>
      <PluginPage {...props} />
    </PluginPageContextProvider>
  )
}

export default PluginPageWithContext
