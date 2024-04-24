
'use client'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useState } from 'react'
import { useAppContext } from '@/context/app-context'
import { useRouter } from 'next/navigation'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import Button from '@/app/components/base/button'
import { createWorkspaceNew } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'

type IAccountSettingProps = {
  onCancel: () => void
}
const inputClassName = `
  mt-2 w-full px-3 py-2 bg-gray-100 rounded
  text-sm font-normal text-gray-800
`



export default function WorkSpaceSetting({
  onCancel
}: IAccountSettingProps) {
  const [workSpaceName  , setWorkSpaceName] = useState('')
  const { notify } = useContext(ToastContext)
  const { userProfile, langeniusVersionInfo } = useAppContext()
  const { t } = useTranslation()
  const createWorkspace = async () => {
    try {
        var emailName= userProfile.email
        console.log(emailName)
        await createWorkspaceNew({ url: '/enterprise/workspace', body: { name:workSpaceName, owner_email:emailName,} })
        notify({ type: 'success', message: t('创建工作空间成功') })
        location.assign(`${location.origin}`)
    }
    catch (e) {
      // 打印错误 e
      console.error('发生错误:', e)
      notify({ type: 'error', message: t('创建工作空间失败') })
    }
  } 
  return (
    <Modal
      isShow
      onClose={() => { }}
      className={s.modal}
    >
       <div className='shrink-0 flex justify-between items-center pl-6 pr-5 h-14 border-b border-b-gray-100'>
        <div className='flex flex-col text-base font-semibold text-gray-900'>
          <div className='leading-6'>{t('创建工作空间')}</div>
        </div>
        <div className='flex items-center'>
          <div
            onClick={onCancel}
            className='flex justify-center items-center w-6 h-6 cursor-pointer'
          >
            <XClose className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
        <div className='relative pt-4'>
        
            <input
              type="text"
              className={inputClassName}
              value={workSpaceName}
              onChange={e => setWorkSpaceName(e.target.value)}
            />
            <div className='flex justify-end mt-10'>
              <Button
                type='primary'
                className='text-sm font-medium'
                onClick={createWorkspace}
              >
                {t('common.operation.create') }
              </Button>
            </div>
          </div>
    </Modal>
  )
}
