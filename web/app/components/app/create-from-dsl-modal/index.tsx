'use client'

import type { MouseEventHandler } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import { useRouter } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
// import type { AppMode } from '@/types/app'
import { ToastContext } from '@/app/components/base/toast'
// import { createApp, fetchAppTemplates } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { Trash03, UploadCloud01, XClose } from '@/app/components/base/icons/src/vender/line/general'

type CreateFromDSLModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
}

const CreateFromDSLModal = ({ show, onSuccess, onClose }: CreateFromDSLModalProps) => {
  const router = useRouter()
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [currentFile, setDSLFile] = useState<File | null>()
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploader = useRef<HTMLInputElement>(null)

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.target !== dragRef.current && setDragging(true)
  }
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.target === dragRef.current && setDragging(false)
  }

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!e.dataTransfer)
      return

    const files = [...e.dataTransfer.files] as File[]
    setDSLFile(files[0])
  }, [setDSLFile])

  const selectHandle = () => {
    if (fileUploader.current)
      fileUploader.current.click()
  }

  const fileChangeHandle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])] as File[]
    console.log(files[0])
    setDSLFile(files[0])
  }

  const removeFile = () => {
    if (fileUploader.current)
      fileUploader.current.value = ''
    setDSLFile(null)
  }

  // utils
  // const getFileType = (currentFile: File) => {
  //   if (!currentFile)
  //     return ''

  //   const arr = currentFile.name.split('.')
  //   return arr[arr.length - 1]
  // }

  const getFileSize = (size: number) => {
    if (size / 1024 < 10)
      return `${(size / 1024).toFixed(2)}KB`

    return `${(size / 1024 / 1024).toFixed(2)}MB`
  }

  useEffect(() => {
    dropRef.current?.addEventListener('dragenter', handleDragEnter)
    dropRef.current?.addEventListener('dragover', handleDragOver)
    dropRef.current?.addEventListener('dragleave', handleDragLeave)
    dropRef.current?.addEventListener('drop', handleDrop)
    return () => {
      dropRef.current?.removeEventListener('dragenter', handleDragEnter)
      dropRef.current?.removeEventListener('dragover', handleDragOver)
      dropRef.current?.removeEventListener('dragleave', handleDragLeave)
      dropRef.current?.removeEventListener('drop', handleDrop)
    }
  }, [handleDrop])

  const { isCurrentWorkspaceManager } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const isCreatingRef = useRef(false)
  // #TODO# use import api
  const onCreate: MouseEventHandler = async () => {
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    try {
      // const app = await createApp()
      if (onSuccess)
        onSuccess()
      if (onClose)
        onClose()
      notify({ type: 'success', message: t('app.newApp.appCreated') })
      // router.push(`/app/${app.id}/${isCurrentWorkspaceManager ? 'configuration' : 'overview'}`)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
    isCreatingRef.current = false
  }

  return (
    <Modal
      wrapperClassName='z-20'
      className='px-8 py-6 max-w-[520px] w-[520px] rounded-xl'
      isShow={show}
      onClose={() => {}}
    >
      <div className='relative pb-2 text-xl font-medium leading-[30px] text-gray-900'>{t('app.createFromConfigFile')}</div>
      <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={onClose}>
        <XClose className='w-4 h-4 text-gray-500' />
      </div>
      <div className='pt-5 pb-7'>
        <input
          ref={fileUploader}
          id="fileUploader"
          style={{ display: 'none' }}
          type="file"
          onChange={fileChangeHandle}
        />
        <div ref={dropRef}>
          {!currentFile && (
            <div className={cn(
              'relative flex justify-center items-center h-20 bg-gray-50 rounded-xl border border-dashed border-gray-200',
              dragging && '!bg-[#F5F8FF] !border-[#B2CCFF]',
            )}>

              <div className='flex justify-center items-center'>
                <UploadCloud01 className='w-6 h-6 mr-2'/>
                <span className='text-sm text-gray-500'>
                  {t('datasetCreation.stepOne.uploader.button')}
                  <label className='pl-1 cursor-pointer text-[#155eef]' onClick={selectHandle}>{t('datasetCreation.stepOne.uploader.browse')}</label>
                </span>
              </div>
            </div>
          )}
          {dragging && <div ref={dragRef} className='absolute top-0 left-0 w-full h-full' />}
        </div>
        {currentFile && (
          <div className='group relative flex justify-center items-center justify-between h-20 pl-[64px] pr-6 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer hover:bg-[#f5f8ff] hover:border-[#d1e0ff]'>
            {/* TODO type icon */}
            <div className='absolute top-[24px] left-[24px] w-8 h-8'/>
            <div className='grow truncate'>
              <div className='truncate text-sm leading-[20px] font-medium text-gray-800'>{currentFile.name}</div>
              <div className='text-xs leading-[18px] text-gray-500'>{getFileSize(currentFile.size)}</div>
            </div>
            <div className='shrink-0 hidden group-hover:flex'>
              <Trash03 className='w-4 h-4 text-gray-500 cursor-pointer' onClick={(e) => {
                e.stopPropagation()
                removeFile()
              }} />
            </div>
          </div>
        )}
      </div>
      {isAppsFull && <AppsFull loc='app-create-dsl' />}
      <div className='pt-6 flex justify-end'>
        <Button className='mr-2 text-gray-700 text-sm font-medium' onClick={onClose}>{t('app.newApp.Cancel')}</Button>
        <Button className='text-sm font-medium' disabled={isAppsFull || !currentFile} type="primary" onClick={onCreate}>{t('app.newApp.Create')}</Button>
      </div>
    </Modal>
  )
}

export default CreateFromDSLModal
