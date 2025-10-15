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
import DifyLogo from '@/app/components/base/logo/dify-logo'
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
import { useGlobalPublicStore } from '@/context/global-public-context'

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
  const [imgKey, setImgKey] = useState(() => Date.now())
  const [uploadProgress, setUploadProgress] = useState(0)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
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
      <div className='system-md-medium mb-2 flex items-center justify-between rounded-xl bg-background-section-burn p-4 text-text-primary'>
        {t('custom.webapp.removeBrand')}
        <Switch
          size='l'
          defaultValue={webappBrandRemoved}
          disabled={isSandbox || !isCurrentWorkspaceManager}
          onChange={handleSwitch}
        />
      </div>
      <div className={cn('flex h-14 items-center justify-between rounded-xl bg-background-section-burn px-4', webappBrandRemoved && 'opacity-30')}>
        <div>
          <div className='system-md-medium text-text-primary'>{t('custom.webapp.changeLogo')}</div>
          <div className='system-xs-regular text-text-tertiary'>{t('custom.webapp.changeLogoTip')}</div>
        </div>
        <div className='flex items-center'>
          {(!uploadDisabled && webappLogo && !webappBrandRemoved) && (
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
                <RiImageAddLine className='mr-1 h-4 w-4' />
                {
                  (webappLogo || fileId)
                    ? t('custom.change')
                    : t('custom.upload')
                }
                <input
                  className={cn('absolute inset-0 block w-full text-[0] opacity-0', uploadDisabled ? 'cursor-not-allowed' : 'cursor-pointer')}
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
                <RiLoader2Line className='mr-1 h-4 w-4 animate-spin' />
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
      <div className='mb-2 mt-5 flex items-center gap-2'>
        <div className='system-xs-medium-uppercase shrink-0 text-text-tertiary'>{t('appOverview.overview.appInfo.preview')}</div>
        <Divider bgStyle='gradient' className='grow' />
      </div>
      <div className='relative mb-2 flex items-center gap-3'>
        {/* chat card */}
        <div className='flex h-[320px] grow basis-1/2 overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-background-default-burn'>
          <div className='flex h-full w-[232px] shrink-0 flex-col p-1 pr-0'>
            <div className='flex items-center gap-3 p-3 pr-2'>
              <div className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg border border-divider-regular', 'bg-components-icon-bg-blue-light-solid')}>
                <BubbleTextMod className='h-4 w-4 text-components-avatar-shape-fill-stop-100' />
              </div>
              <div className='system-md-semibold grow text-text-secondary'>Chatflow App</div>
              <div className='p-1.5'>
                <RiLayoutLeft2Line className='h-4 w-4 text-text-tertiary' />
              </div>
            </div>
            <div className='shrink-0 px-4 py-3'>
              <Button variant='secondary-accent' className='w-full justify-center'>
                <RiEditBoxLine className='mr-1 h-4 w-4' />
                <div className='p-1 opacity-20'>
                  <div className='h-2 w-[94px] rounded-sm bg-text-accent-light-mode-only'></div>
                </div>
              </Button>
            </div>
            <div className='grow px-3 pt-5'>
              <div className='flex h-8 items-center px-3 py-1'>
                <div className='h-2 w-14 rounded-sm bg-text-quaternary opacity-20'></div>
              </div>
              <div className='flex h-8 items-center px-3 py-1'>
                <div className='h-2 w-[168px] rounded-sm bg-text-quaternary opacity-20'></div>
              </div>
              <div className='flex h-8 items-center px-3 py-1'>
                <div className='h-2 w-[128px] rounded-sm bg-text-quaternary opacity-20'></div>
              </div>
            </div>
            <div className='flex shrink-0 items-center justify-between p-3'>
              <div className='p-1.5'>
                <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
              </div>
              <div className='flex items-center gap-1.5'>
                {!webappBrandRemoved && (
                  <>
                    <div className='system-2xs-medium-uppercase text-text-tertiary'>POWERED BY</div>
                    {
                      systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
                        ? <img src={systemFeatures.branding.workspace_logo} alt='logo' className='block h-5 w-auto' />
                        : webappLogo
                          ? <img src={`${webappLogo}?hash=${imgKey}`} alt='logo' className='block h-5 w-auto' />
                          : <DifyLogo size='small' />
                    }
                  </>
                )}
              </div>
            </div>
          </div>
          <div className='flex w-[138px] grow flex-col justify-between p-2 pr-0'>
            <div className='flex grow flex-col justify-between rounded-l-2xl border-[0.5px] border-r-0 border-components-panel-border-subtle bg-chatbot-bg pb-4 pl-[22px] pt-16'>
              <div className='w-[720px] rounded-2xl border border-divider-subtle bg-chat-bubble-bg px-4 py-3'>
                <div className='body-md-regular mb-1 text-text-primary'>Hello! How can I assist you today?</div>
                <Button size='small'>
                  <div className='h-2 w-[144px] rounded-sm bg-text-quaternary opacity-20'></div>
                </Button>
              </div>
              <div className='body-lg-regular flex h-[52px] w-[578px] items-center rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pl-3.5 text-text-placeholder shadow-md backdrop-blur-sm'>Talk to Dify</div>
            </div>
          </div>
        </div>
        {/* workflow card */}
        <div className='flex h-[320px] grow basis-1/2 flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-background-default-burn'>
          <div className='w-full border-b-[0.5px] border-divider-subtle p-4 pb-0'>
            <div className='mb-2 flex items-center gap-3'>
              <div className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg border border-divider-regular', 'bg-components-icon-bg-indigo-solid')}>
                <RiExchange2Fill className='h-4 w-4 text-components-avatar-shape-fill-stop-100' />
              </div>
              <div className='system-md-semibold grow text-text-secondary'>Workflow App</div>
              <div className='p-1.5'>
                <RiLayoutLeft2Line className='h-4 w-4 text-text-tertiary' />
              </div>
            </div>
            <div className='flex items-center gap-4'>
              <div className='system-md-semibold-uppercase flex h-10 shrink-0 items-center border-b-2 border-components-tab-active text-text-primary'>RUN ONCE</div>
              <div className='system-md-semibold-uppercase flex h-10 grow items-center border-b-2 border-transparent text-text-tertiary'>RUN BATCH</div>
            </div>
          </div>
          <div className='grow bg-components-panel-bg'>
            <div className='p-4 pb-1'>
              <div className='mb-1 py-2'>
                <div className='h-2 w-20 rounded-sm bg-text-quaternary opacity-20'></div>
              </div>
              <div className='h-16 w-full rounded-lg bg-components-input-bg-normal '></div>
            </div>
            <div className='flex items-center justify-between px-4 py-3'>
              <Button size='small'>
                <div className='h-2 w-10 rounded-sm bg-text-quaternary opacity-20'></div>
              </Button>
              <Button variant='primary' size='small' disabled>
                <RiPlayLargeLine className='mr-1 h-4 w-4' />
                <span>Execute</span>
              </Button>
            </div>
          </div>
          <div className='flex h-12 shrink-0 items-center gap-1.5 bg-components-panel-bg p-4 pt-3'>
            {!webappBrandRemoved && (
              <>
                <div className='system-2xs-medium-uppercase text-text-tertiary'>POWERED BY</div>
                {
                  systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
                    ? <img src={systemFeatures.branding.workspace_logo} alt='logo' className='block h-5 w-auto' />
                    : webappLogo
                      ? <img src={`${webappLogo}?hash=${imgKey}`} alt='logo' className='block h-5 w-auto' />
                      : <DifyLogo size='small' />
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
