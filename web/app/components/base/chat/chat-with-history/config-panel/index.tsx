import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import Form from './form'
import Button from '@/app/components/base/button'
import AppIcon from '@/app/components/base/app-icon'
import { MessageDotsCircle } from '@/app/components/base/icons/src/vender/solid/communication'
import { Edit02 } from '@/app/components/base/icons/src/vender/line/general'
import { Star06 } from '@/app/components/base/icons/src/vender/solid/shapes'
import LogoSite from '@/app/components/base/logo/logo-site'

const ConfigPanel = () => {
  const { t } = useTranslation()
  const {
    appData,
    inputsForms,
    handleStartChat,
    showConfigPanelBeforeChat,
    isMobile,
  } = useChatWithHistoryContext()
  const [collapsed, setCollapsed] = useState(true)
  const customConfig = appData?.custom_config
  const site = appData?.site

  return (
    <div className='flex max-h-[80%] w-full max-w-[720px] flex-col'>
      <div
        className={`
          grow overflow-y-auto rounded-xl
          ${showConfigPanelBeforeChat && 'border-[0.5px] border-gray-100 shadow-lg'}
          ${!showConfigPanelBeforeChat && collapsed && 'border border-indigo-100'}
          ${!showConfigPanelBeforeChat && !collapsed && 'border-[0.5px] border-gray-100 shadow-lg'}
        `}
      >
        <div
          className={`
            bg-indigo-25 flex flex-wrap rounded-t-xl px-6 py-4
            ${isMobile && '!px-4 !py-3'}
          `}
        >
          {
            showConfigPanelBeforeChat && (
              <>
                <div className='flex h-8 items-center text-2xl font-semibold text-gray-800'>
                  <AppIcon
                    iconType={appData?.site.icon_type}
                    icon={appData?.site.icon}
                    background='transparent'
                    imageUrl={appData?.site.icon_url}
                    size='small'
                    className="mr-2"
                  />
                  {appData?.site.title}
                </div>
                {
                  appData?.site.description && (
                    <div className='mt-2 w-full text-sm text-gray-500'>
                      {appData?.site.description}
                    </div>
                  )
                }
              </>
            )
          }
          {
            !showConfigPanelBeforeChat && collapsed && (
              <>
                <Star06 className='mr-1 mt-1 h-4 w-4 text-indigo-600' />
                <div className='grow py-[3px] text-[13px] font-medium leading-[18px] text-indigo-600'>
                  {t('share.chat.configStatusDes')}
                </div>
                <Button
                  variant='secondary-accent'
                  size='small'
                  className='shrink-0'
                  onClick={() => setCollapsed(false)}
                >
                  <Edit02 className='mr-1 h-3 w-3' />
                  {t('common.operation.edit')}
                </Button>
              </>
            )
          }
          {
            !showConfigPanelBeforeChat && !collapsed && (
              <>
                <Star06 className='mr-1 mt-1 h-4 w-4 text-indigo-600' />
                <div className='grow py-[3px] text-[13px] font-medium leading-[18px] text-indigo-600'>
                  {t('share.chat.privatePromptConfigTitle')}
                </div>
              </>
            )
          }
        </div>
        {
          !collapsed && !showConfigPanelBeforeChat && (
            <div className='rounded-b-xl p-6'>
              <Form />
              <div className={`flex items-center pl-[136px] ${isMobile && '!pl-0'}`}>
                <Button
                  variant='primary'
                  className='mr-2'
                  onClick={() => {
                    setCollapsed(true)
                    handleStartChat()
                  }}
                >
                  {t('common.operation.save')}
                </Button>
                <Button
                  onClick={() => setCollapsed(true)}
                >
                  {t('common.operation.cancel')}
                </Button>
              </div>
            </div>
          )
        }
        {
          showConfigPanelBeforeChat && (
            <div className='rounded-b-xl p-6'>
              <Form />
              <Button
                className={`${inputsForms.length && !isMobile && 'ml-[136px]'}`}
                variant='primary'
                size='large'
                onClick={handleStartChat}
              >
                <MessageDotsCircle className='mr-2 h-4 w-4 text-white' />
                {t('share.chat.startChat')}
              </Button>
            </div>
          )
        }
      </div>
      {
        showConfigPanelBeforeChat && (site || customConfig) && (
          <div className='mt-4 flex flex-wrap items-center justify-between py-2 text-xs text-gray-400'>
            {site?.privacy_policy
              ? <div className={`flex items-center ${isMobile && 'w-full justify-end'}`}>{t('share.chat.privacyPolicyLeft')}
                <a
                  className='px-1 text-gray-500'
                  href={site?.privacy_policy}
                  target='_blank' rel='noopener noreferrer'>{t('share.chat.privacyPolicyMiddle')}</a>
                {t('share.chat.privacyPolicyRight')}
              </div>
              : <div>
              </div>}
            {
              customConfig?.remove_webapp_brand
                ? null
                : (
                  <div className={`flex items-center justify-end ${isMobile && 'w-full'}`}>
                    <div className='flex items-center space-x-3 pr-3'>
                      <span className='uppercase'>{t('share.chat.poweredBy')}</span>
                      {
                        customConfig?.replace_webapp_logo
                          ? <img src={customConfig?.replace_webapp_logo} alt='logo' className='block h-5 w-auto' />
                          : <LogoSite className='!h-5' />
                      }
                    </div>
                  </div>
                )
            }
          </div>
        )
      }
    </div>
  )
}

export default ConfigPanel
