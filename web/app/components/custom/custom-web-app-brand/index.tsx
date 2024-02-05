import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import LogoSite from '@/app/components/base/logo/logo-site'
import Switch from '@/app/components/base/switch'
import Button from '@/app/components/base/button'
import { Loading02 } from '@/app/components/base/icons/src/vender/line/general'
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
import { API_PREFIX } from '@/config'
import { getPurifyHref } from '@/utils'

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
  }

  const handleRestore = async () => {
    await updateCurrentWorkspace({
      url: '/workspaces/custom-config',
      body: {
        remove_webapp_brand: false,
        replace_webapp_logo: null,
      },
    })
    mutateCurrentWorkspace()
  }

  const handleSwitch = async (checked: boolean) => {
    await updateCurrentWorkspace({
      url: '/workspaces/custom-config',
      body: {
        remove_webapp_brand: checked,
        replace_webapp_logo: webappLogo,
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
      <div className='relative mb-4 pl-4 pb-6 pr-[119px] rounded-xl border-[0.5px] border-black/[0.08] shadow-xs bg-gray-50 overflow-hidden'>
        <div className={`${s.mask} absolute top-0 left-0 w-full -bottom-2 z-10`}></div>
        <div className='flex items-center -mt-2 mb-4 p-6 bg-white rounded-xl'>
          <div className='flex items-center px-4 w-[125px] h-9 rounded-lg bg-primary-600 border-[0.5px] border-primary-700 shadow-xs'>
            <MessageDotsCircle className='shrink-0 mr-2 w-4 h-4 text-white' />
            <div className='grow h-2 rounded-sm bg-white opacity-50' />
          </div>
        </div>
        <div className='flex items-center h-5 justify-between'>
          <div className='w-[369px] h-1.5 rounded-sm bg-gray-200 opacity-80' />
          {
            !webappBrandRemoved && (
              <div className='flex items-center text-[10px] font-medium text-gray-400'>
                POWERED BY
                {
                  webappLogo
                    ? <img key={webappLogo} src={`${getPurifyHref(API_PREFIX.slice(0, -12))}/files/workspaces/${currentWorkspace.id}/webapp-logo`} alt='logo' className='ml-2 block w-auto h-5' />
                    : <LogoSite className='ml-2 !h-5' />
                }
              </div>
            )
          }
        </div>
      </div>
      <div className='flex items-center justify-between mb-2 px-4 h-14 rounded-xl border-[0.5px] border-gray-200 bg-gray-50 text-sm font-medium text-gray-900'>
        {t('custom.webapp.removeBrand')}
        <Switch
          size='l'
          defaultValue={webappBrandRemoved}
          disabled={isSandbox || !isCurrentWorkspaceManager}
          onChange={handleSwitch}
        />
      </div>
      <div className={`
        flex items-center justify-between px-4 py-3 rounded-xl border-[0.5px] border-gray-200 bg-gray-50
        ${webappBrandRemoved && 'opacity-30'}
      `}>
        <div>
          <div className='leading-5 text-sm font-medium text-gray-900'>{t('custom.webapp.changeLogo')}</div>
          <div className='leading-[18px] text-xs text-gray-500'>{t('custom.webapp.changeLogoTip')}</div>
        </div>
        <div className='flex items-center'>
          {
            !uploading && (
              <Button
                className={`
                  relative mr-2 !h-8 !px-3 bg-white !text-[13px] 
                  ${uploadDisabled ? 'opacity-40' : ''}
                `}
                disabled={uploadDisabled}
              >
                <ImagePlus className='mr-2 w-4 h-4' />
                {
                  (webappLogo || fileId)
                    ? t('custom.change')
                    : t('custom.upload')
                }
                <input
                  className={`
                    absolute block inset-0 opacity-0 text-[0] w-full
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
                className='relative mr-2 !h-8 !px-3 bg-white !text-[13px] opacity-40'
                disabled={true}
              >
                <Loading02 className='animate-spin mr-2 w-4 h-4' />
                {t('custom.uploading')}
              </Button>
            )
          }
          {
            fileId && (
              <>
                <Button
                  type='primary'
                  className='mr-2 !h-8 !px-3 !py-0 !text-[13px]'
                  onClick={handleApply}
                  disabled={webappBrandRemoved || !isCurrentWorkspaceManager}
                >
                  {t('custom.apply')}
                </Button>
                <Button
                  className='mr-2 !h-8 !px-3 !text-[13px] bg-white'
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
            className={`
              !h-8 !px-3 bg-white !text-[13px] 
              ${(uploadDisabled || (!webappLogo && !webappBrandRemoved)) ? 'opacity-40' : ''}
            `}
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
