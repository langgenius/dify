'use client'

import type { MouseEventHandler } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Uploader from './uploader'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import {
  importApp,
  importAppFromUrl,
} from '@/service/apps'
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
  dslUrl?: string
}

export enum CreateFromDSLModalTab {
  FROM_FILE = 'from-file',
  FROM_URL = 'from-url',
}

const CreateFromDSLModal = ({ show, onSuccess, onClose, activeTab = CreateFromDSLModalTab.FROM_FILE, dslUrl = '' }: CreateFromDSLModalProps) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [currentFile, setDSLFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [dslUrlValue, setDslUrlValue] = useState(dslUrl)

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
    if (currentTab === CreateFromDSLModalTab.FROM_FILE && !currentFile)
      return
    if (currentTab === CreateFromDSLModalTab.FROM_URL && !dslUrlValue)
      return
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    try {
      let app

      if (currentTab === CreateFromDSLModalTab.FROM_FILE) {
        app = await importApp({
          data: fileContent || '',
        })
      }
      if (currentTab === CreateFromDSLModalTab.FROM_URL) {
        app = await importAppFromUrl({
          url: dslUrlValue || '',
        })
      }
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
      key: CreateFromDSLModalTab.FROM_FILE,
      label: t('app.importFromDSLFile'),
    },
    {
      key: CreateFromDSLModalTab.FROM_URL,
      label: t('app.importFromDSLUrl'),
    },
  ]

  const buttonDisabled = useMemo(() => {
    if (isAppsFull)
      return true
    if (currentTab === CreateFromDSLModalTab.FROM_FILE)
      return !currentFile
    if (currentTab === CreateFromDSLModalTab.FROM_URL)
      return !dslUrlValue
    return false
  }, [isAppsFull, currentTab, currentFile, dslUrlValue])

  return (
    <Modal
      className='p-0 w-[520px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'
      isShow={show}
      onClose={() => { }}
    >
      <div className='flex items-center justify-between pt-6 pl-6 pr-5 pb-3 text-text-primary title-2xl-semi-bold'>
        {t('app.importFromDSL')}
        <div
          className='flex items-center w-8 h-8 cursor-pointer'
          onClick={() => onClose()}
        >
          <RiCloseLine className='w-5 h-5 text-text-tertiary' />
        </div>
      </div>
      <div className='flex items-center px-6 h-9 space-x-6 system-md-semibold text-text-tertiary border-b border-divider-subtle'>
        {
          tabs.map(tab => (
            <div
              key={tab.key}
              className={cn(
                'relative flex items-center h-full cursor-pointer',
                currentTab === tab.key && 'text-text-primary',
              )}
              onClick={() => setCurrentTab(tab.key)}
            >
              {tab.label}
              {
                currentTab === tab.key && (
                  <div className='absolute bottom-0 w-full h-[2px] bg-util-colors-blue-brand-blue-brand-600'></div>
                )
              }
            </div>
          ))
        }
      </div>
      <div className='px-6 py-4'>
        {
          currentTab === CreateFromDSLModalTab.FROM_FILE && (
            <Uploader
              className='mt-0'
              file={currentFile}
              updateFile={handleFile}
            />
          )
        }
        {
          currentTab === CreateFromDSLModalTab.FROM_URL && (
            <div>
              <div className='mb-1 system-md-semibold leading6'>DSL URL</div>
              <Input
                placeholder={t('app.importFromDSLUrlPlaceholder') || ''}
                value={dslUrlValue}
                onChange={e => setDslUrlValue(e.target.value)}
              />
            </div>
          )
        }
      </div>
      {isAppsFull && (
        <div className='px-6'>
          <AppsFull className='mt-0' loc='app-create-dsl' />
        </div>
      )}
      <div className='flex justify-end px-6 py-5'>
        <Button className='mr-2' onClick={onClose}>{t('app.newApp.Cancel')}</Button>
        <Button disabled={buttonDisabled} variant="primary" onClick={onCreate}>{t('app.newApp.Create')}</Button>
      </div>
    </Modal>
  )
}

export default CreateFromDSLModal
