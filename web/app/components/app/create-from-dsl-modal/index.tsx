'use client'

import type { MouseEventHandler } from 'react'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Uploader from './uploader'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import { importApp } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { getRedirection } from '@/utils/app-redirection'
import cn from '@/utils/classnames'

type CreateFromDSLModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
  activeTab?: string
}

const CreateFromDSLModal = ({ show, onSuccess, onClose, activeTab = 'from-file' }: CreateFromDSLModalProps) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [currentFile, setDSLFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  const [currentTab, setCurrentTab] = useState(activeTab)

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = function (event) {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }

  const handleFile = (file?: File) => {
    setDSLFile(file)
    if (file)
      readFile(file)
    if (!file)
      setFileContent('')
  }

  const { isCurrentWorkspaceEditor } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const isCreatingRef = useRef(false)
  const onCreate: MouseEventHandler = async () => {
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    if (!currentFile)
      return
    try {
      const app = await importApp({
        data: fileContent || '',
      })
      if (onSuccess)
        onSuccess()
      if (onClose)
        onClose()
      notify({ type: 'success', message: t('app.newApp.appCreated') })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      getRedirection(isCurrentWorkspaceEditor, app, push)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
    isCreatingRef.current = false
  }

  const tabs = [
    {
      key: 'from-file',
      label: 'from dsl file',
    },
    {
      key: 'from-url',
      label: 'from url',
    },
  ]

  return (
    <Modal
      className='p-0 w-[520px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'
      isShow={show}
      onClose={() => { }}
    >
      <div className='flex items-center justify-between pt-3 pl-6 pr-5 text-text-primary title-2xl-semi-bold'>
        {t('app.createFromConfigFile')}
        <div className='flex items-center w-8 h-8 cursor-pointer'>
          <RiCloseLine className='w-5 h-5 text-text-tertiary' />
        </div>
      </div>
      <div className='flex items-center px-6 h-9 space-x-6 system-md-semibold text-text-tertiary border-b border-divider-subtle'>
        {
          tabs.map(tab => (
            <div
              key={tab.key}
              className={cn(
                'border-[2px] cursor-pointer',
                currentTab === tab.key && 'text-text-primary',
              )}
              onClick={() => setCurrentTab(tab.key)}
            >
              {tab.label}
            </div>
          ))
        }
      </div>
      <div className='px-6 py-4'>
        {
          currentTab === 'from-file' && (
            <Uploader
              className='mt-0'
              file={currentFile}
              updateFile={handleFile}
            />
          )
        }
        {
          currentTab === 'from-url' && (
            <div>
              <div className='mb-1 system-md-semibold leading6'>DSL URL</div>
              <input
                className='px-2 w-full h-8 border border-components-input-border-active bg-components-input-bg-active rounded-lg outline-none appearance-none placeholder:text-components-input-text-placeholder system-sm-regular'
              />
            </div>
          )
        }
      </div>
      {isAppsFull && <AppsFull loc='app-create-dsl' />}
      <div className='pt-6 flex justify-end'>
        <Button className='mr-2' onClick={onClose}>{t('app.newApp.Cancel')}</Button>
        <Button disabled={isAppsFull || !currentFile} variant="primary" onClick={onCreate}>{t('app.newApp.Create')}</Button>
      </div>
    </Modal>
  )
}

export default CreateFromDSLModal
