import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiLoader2Line,
} from '@remixicon/react'
import s from './style.module.css'
import LogoSite from '@/app/components/base/logo/logo-site'
import Switch from '@/app/components/base/switch'
import Button from '@/app/components/base/button'
import { MessageDotsCircle } from '@/app/components/base/icons/src/vender/solid/communication'
import { ImagePlus } from '@/app/components/base/icons/src/vender/line/images'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'
import { imageUpload } from '@/app/components/base/image-uploader/utils'
import { useToastContext } from '@/app/components/base/toast'
import {
  updateCurrentWorkspace,
} from '@/service/common'
import { useAppContext } from '@/context/app-context'

const ALLOW_FILE_EXTENSIONS = ['svg', 'png']

const CustomWebAppBrand = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { plan, enableBilling } = useProviderContext()
  const {
    currentWorkspace,
    mutateCurrentWorkspace,
    isCurrentWorkspaceManager,
  } = useAppContext()
  const [fileId, setFileId] = useState('')
  const [imgKey, setImgKey] = useState(Date.now())
  const [uploadProgress, setUploadProgress] = useState(0)
  const isSandbox = enableBilling && plan.type === Plan.sandbox
  const uploading = uploadProgress > 0 && uploadProgress < 100
  const webappLogo = currentWorkspace.custom_config?.replace_webapp_logo || ''
  const webappBrandRemoved = currentWorkspace.custom_config?.remove_webapp_brand
  const uploadDisabled = isSandbox || webappBrandRemoved || !isCurrentWorkspaceManager

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file)
      return

    if (file.size > 5 * 1024 * 1024) {
      notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerLimit', { size: 5 }) })
      return
    }

    imageUpload({
      file,
      onProgressCallback: (progress) => {
        setUploadProgress(progress)
      },
      onSuccessCallback: (res) => {
        setUploadProgress(100)
        setFileId(res.id)
      },
      onErrorCallback: () => {
        notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
        setUploadProgress(-1)
      },
    }, false, '/workspaces/custom-config/webapp-logo/upload')
  }

  const handleApply = async () => {
    await updateCurrentWorkspace({
      url: '/workspaces/custom-config',
      body: {
        remove_webapp_brand: webappBrandRemoved,
        replace_webapp_logo: fileId,
      },
    })
    mutateCurrentWorkspace()
    setFileId('')
    setImgKey(Date.now())
  }

  const handleRestore = async () => {
    await updateCurrentWorkspace({
      url: '/workspaces/custom-config',
      body: {
        remove_webapp_brand: false,
        replace_webapp_logo: '',
      },
    })
    mutateCurrentWorkspace()
  }

  const handleSwitch = async (checked: boolean) => {
    await updateCurrentWorkspace({
      url: '/workspaces/custom-config',
      body: {
        remove_webapp_brand: checked,
      },
    })
    mutateCurrentWorkspace()
  }

  const handleCancel = () => {
    setFileId('')
    setUploadProgress(0)
  }

  return (
    <div className='py-4'>
      <div className='mb-2 text-sm font-medium text-gray-900'>{t('custom.webapp.title')}</div>
      <div className='border-black/8 shadow-xs relative mb-4 overflow-hidden rounded-xl border-[0.5px] bg-gray-50 pb-6 pl-4 pr-[119px]'>
        <div className={`${s.mask} absolute -bottom-2 left-0 top-0 z-10 w-full`}></div>
        <div className='-mt-2 mb-4 flex items-center rounded-xl bg-white p-6'>
          <div className='bg-primary-600 border-primary-700 shadow-xs flex h-9 w-[125px] items-center rounded-lg border-[0.5px] px-4'>
            <MessageDotsCircle className='mr-2 h-4 w-4 shrink-0 text-white' />
            <div className='h-2 grow rounded-sm bg-white opacity-50' />
          </div>
        </div>
        <div className='flex h-5 items-center justify-between'>
          <div className='h-1.5 w-[369px] rounded-sm bg-gray-200 opacity-80' />
          {
            !webappBrandRemoved && (
              <div className='flex items-center text-[10px] font-medium text-gray-400'>
                POWERED BY
                {
                  webappLogo
                    ? <img src={`${webappLogo}?hash=${imgKey}`} alt='logo' className='ml-2 block h-5 w-auto' />
                    : <LogoSite className='ml-2 !h-5' />
                }
              </div>
            )
          }
        </div>
      </div>
      <div className='mb-2 flex h-14 items-center justify-between rounded-xl border-[0.5px] border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-900'>
        {t('custom.webapp.removeBrand')}
        <Switch
          size='l'
          defaultValue={webappBrandRemoved}
          disabled={isSandbox || !isCurrentWorkspaceManager}
          onChange={handleSwitch}
        />
      </div>
      <div className={`
        flex items-center justify-between rounded-xl border-[0.5px] border-gray-200 bg-gray-50 px-4 py-3
        ${webappBrandRemoved && 'opacity-30'}
      `}>
        <div>
          <div className='text-sm font-medium leading-5 text-gray-900'>{t('custom.webapp.changeLogo')}</div>
          <div className='text-xs leading-[18px] text-gray-500'>{t('custom.webapp.changeLogoTip')}</div>
        </div>
        <div className='flex items-center'>
          {
            !uploading && (
              <Button
                className={`
                  relative mr-2
                `}
                disabled={uploadDisabled}
              >
                <ImagePlus className='mr-2 h-4 w-4' />
                {
                  (webappLogo || fileId)
                    ? t('custom.change')
                    : t('custom.upload')
                }
                <input
                  className={`
                    absolute inset-0 block w-full text-[0] opacity-0
                    ${uploadDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}
                  `}
                  onClick={e => (e.target as HTMLInputElement).value = ''}
                  type='file'
                  accept={ALLOW_FILE_EXTENSIONS.map(ext => `.${ext}`).join(',')}
                  onChange={handleChange}
                  disabled={uploadDisabled}
                />
              </Button>
            )
          }
          {
            uploading && (
              <Button
                className='relative mr-2'
                disabled={true}
              >
                <RiLoader2Line className='mr-2 h-4 w-4 animate-spin' />
                {t('custom.uploading')}
              </Button>
            )
          }
          {
            fileId && (
              <>
                <Button
                  variant='primary'
                  className='mr-2'
                  onClick={handleApply}
                  disabled={webappBrandRemoved || !isCurrentWorkspaceManager}
                >
                  {t('custom.apply')}
                </Button>
                <Button
                  className='mr-2'
                  onClick={handleCancel}
                  disabled={webappBrandRemoved || !isCurrentWorkspaceManager}
                >
                  {t('common.operation.cancel')}
                </Button>
              </>
            )
          }
          <div className='mr-2 h-5 w-[1px] bg-black/5'></div>
          <Button
            disabled={uploadDisabled || (!webappLogo && !webappBrandRemoved)}
            onClick={handleRestore}
          >
            {t('custom.restore')}
          </Button>
        </div>
      </div>
      {
        uploadProgress === -1 && (
          <div className='mt-2 text-xs text-[#D92D20]'>{t('custom.uploadedFail')}</div>
        )
      }
    </div>
  )
}

export default CustomWebAppBrand
