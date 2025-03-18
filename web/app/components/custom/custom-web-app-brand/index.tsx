import type { ChangeEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEditBoxLine,
  RiEqualizer2Line,
  RiExchange2Fill,
  RiImageAddLine,
  RiLayoutLeft2Line,
  RiLoader2Line,
  RiPlayLargeLine,
} from '@remixicon/react'
import LogoSite from '@/app/components/base/logo/logo-site'
import Switch from '@/app/components/base/switch'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'
import { imageUpload } from '@/app/components/base/image-uploader/utils'
import { useToastContext } from '@/app/components/base/toast'
import { BubbleTextMod } from '@/app/components/base/icons/src/vender/solid/communication'
import {
  updateCurrentWorkspace,
} from '@/service/common'
import { useAppContext } from '@/context/app-context'
import cn from '@/utils/classnames'

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
      <div className='flex items-center justify-between mb-2 p-4 rounded-xl bg-background-section-burn system-md-medium text-text-primary'>
        {t('custom.webapp.removeBrand')}
        <Switch
          size='l'
          defaultValue={webappBrandRemoved}
          disabled={isSandbox || !isCurrentWorkspaceManager}
          onChange={handleSwitch}
        />
      </div>
      <div className={cn('flex items-center justify-between h-14 px-4 rounded-xl bg-background-section-burn', webappBrandRemoved && 'opacity-30')}>
        <div>
          <div className='system-md-medium text-text-primary'>{t('custom.webapp.changeLogo')}</div>
          <div className='system-xs-regular text-text-tertiary'>{t('custom.webapp.changeLogoTip')}</div>
        </div>
        <div className='flex items-center'>
          {(uploadDisabled || (!webappLogo && !webappBrandRemoved)) && (
            <>
              <Button
                variant='ghost'
                disabled={uploadDisabled || (!webappLogo && !webappBrandRemoved)}
                onClick={handleRestore}
              >
                {t('custom.restore')}
              </Button>
              <div className='mx-2 h-5 w-[1px] bg-divider-regular'></div>
            </>
          )}
          {
            !uploading && (
              <Button
                className='relative mr-2'
                disabled={uploadDisabled}
              >
                <RiImageAddLine className='mr-1 w-4 h-4' />
                {
                  (webappLogo || fileId)
                    ? t('custom.change')
                    : t('custom.upload')
                }
                <input
                  className={cn('absolute block inset-0 opacity-0 text-[0] w-full', uploadDisabled ? 'cursor-not-allowed' : 'cursor-pointer')}
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
                <RiLoader2Line className='animate-spin mr-1 w-4 h-4' />
                {t('custom.uploading')}
              </Button>
            )
          }
          {
            fileId && (
              <>
                <Button
                  className='mr-2'
                  onClick={handleCancel}
                  disabled={webappBrandRemoved || !isCurrentWorkspaceManager}
                >
                  {t('common.operation.cancel')}
                </Button>
                <Button
                  variant='primary'
                  className='mr-2'
                  onClick={handleApply}
                  disabled={webappBrandRemoved || !isCurrentWorkspaceManager}
                >
                  {t('custom.apply')}
                </Button>
              </>
            )
          }
        </div>
      </div>
      {uploadProgress === -1 && (
        <div className='mt-2 text-xs text-[#D92D20]'>{t('custom.uploadedFail')}</div>
      )}
      <div className='mt-5 mb-2 flex items-center gap-2'>
        <div className='shrink-0 system-xs-medium-uppercase text-text-tertiary'>{t('appOverview.overview.appInfo.preview')}</div>
        <Divider bgStyle='gradient' className='grow' />
      </div>
      <div className='relative mb-2 flex items-center gap-3'>
        {/* chat card */}
        <div className='grow basis-1/2 h-[320px] flex bg-background-default-burn rounded-2xl border-[0.5px] border-components-panel-border-subtle overflow-hidden'>
          <div className='shrink-0 h-full w-[232px] p-1 pr-0 flex flex-col'>
            <div className='p-3 pr-2 flex items-center gap-3'>
              <div className={cn('w-8 h-8 inline-flex items-center justify-center rounded-lg border border-divider-regular', 'bg-components-icon-bg-blue-light-solid')}>
                <BubbleTextMod className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
              </div>
              <div className='grow system-md-semibold text-text-secondary'>Chatflow App</div>
              <div className='p-1.5'>
                <RiLayoutLeft2Line className='w-4 h-4 text-text-tertiary' />
              </div>
            </div>
            <div className='shrink-0 px-4 py-3'>
              <Button variant='secondary-accent' className='w-full justify-center'>
                <RiEditBoxLine className='w-4 h-4 mr-1' />
                <div className='p-1 opacity-20'>
                  <div className='h-2 w-[94px] rounded-sm bg-text-accent-light-mode-only'></div>
                </div>
              </Button>
            </div>
            <div className='grow px-3 pt-5'>
              <div className='h-8 px-3 py-1 flex items-center'>
                <div className='w-14 h-2 rounded-sm bg-text-quaternary opacity-20'></div>
              </div>
              <div className='h-8 px-3 py-1 flex items-center'>
                <div className='w-[168px] h-2 rounded-sm bg-text-quaternary opacity-20'></div>
              </div>
              <div className='h-8 px-3 py-1 flex items-center'>
                <div className='w-[128px] h-2 rounded-sm bg-text-quaternary opacity-20'></div>
              </div>
            </div>
            <div className='shrink-0 p-3 flex items-center justify-between'>
              <div className='p-1.5'>
                <RiEqualizer2Line className='w-4 h-4 text-text-tertiary' />
              </div>
              <div className='flex items-center gap-1.5'>
                {!webappBrandRemoved && (
                  <>
                    <div className='text-text-tertiary system-2xs-medium-uppercase'>POWERED BY</div>
                    {webappLogo
                      ? <img src={`${webappLogo}?hash=${imgKey}`} alt='logo' className='block w-auto h-5' />
                      : <LogoSite className='!h-5' />
                    }
                  </>
                )}
              </div>
            </div>
          </div>
          <div className='grow flex flex-col justify-between w-[138px] p-2 pr-0'>
            <div className='grow pt-16 pl-[22px] pb-4 flex flex-col justify-between bg-chatbot-bg rounded-l-2xl border-[0.5px] border-r-0 border-components-panel-border-subtle'>
              <div className='w-[720px] px-4 py-3 bg-chat-bubble-bg rounded-2xl border border-divider-subtle'>
                <div className='mb-1 text-text-primary body-md-regular'>Hello! How can I assist you today?</div>
                <Button size='small'>
                  <div className='w-[144px] h-2 rounded-sm bg-text-quaternary opacity-20'></div>
                </Button>
              </div>
              <div className='w-[578px] h-[52px] flex items-center pl-3.5 rounded-xl bg-components-panel-bg-blur backdrop-blur-sm border border-components-chat-input-border shadow-md text-text-placeholder body-lg-regular'>Talk to Dify</div>
            </div>
          </div>
        </div>
        {/* workflow card */}
        <div className='grow basis-1/2 h-[320px] flex flex-col bg-background-default-burn rounded-2xl border-[0.5px] border-components-panel-border-subtle overflow-hidden'>
          <div className='w-full p-4 pb-0 border-b-[0.5px] border-divider-subtle'>
            <div className='mb-2 flex items-center gap-3'>
              <div className={cn('w-8 h-8 inline-flex items-center justify-center rounded-lg border border-divider-regular', 'bg-components-icon-bg-indigo-solid')}>
                <RiExchange2Fill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
              </div>
              <div className='grow system-md-semibold text-text-secondary'>Workflow App</div>
              <div className='p-1.5'>
                <RiLayoutLeft2Line className='w-4 h-4 text-text-tertiary' />
              </div>
            </div>
            <div className='flex items-center gap-4'>
              <div className='shrink-0 h-10 flex items-center border-b-2 border-components-tab-active text-text-primary system-md-semibold-uppercase'>RUN ONCE</div>
              <div className='grow h-10 flex items-center border-b-2 border-transparent text-text-tertiary system-md-semibold-uppercase'>RUN BATCH</div>
            </div>
          </div>
          <div className='grow bg-components-panel-bg'>
            <div className='p-4 pb-1'>
              <div className='mb-1 py-2'>
                <div className='w-20 h-2 rounded-sm bg-text-quaternary opacity-20'></div>
              </div>
              <div className='w-full h-16 rounded-lg bg-components-input-bg-normal '></div>
            </div>
            <div className='px-4 py-3 flex items-center justify-between'>
              <Button size='small'>
                <div className='w-10 h-2 rounded-sm bg-text-quaternary opacity-20'></div>
              </Button>
              <Button variant='primary' size='small' disabled>
                <RiPlayLargeLine className='mr-1 w-4 h-4' />
                <span>Execute</span>
              </Button>
            </div>
          </div>
          <div className='shrink-0 h-12 p-4 pt-3 flex items-center gap-1.5 bg-components-panel-bg'>
            {!webappBrandRemoved && (
              <>
                <div className='text-text-tertiary system-2xs-medium-uppercase'>POWERED BY</div>
                {webappLogo
                  ? <img src={`${webappLogo}?hash=${imgKey}`} alt='logo' className='block w-auto h-5' />
                  : <LogoSite className='!h-5' />
                }
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CustomWebAppBrand
