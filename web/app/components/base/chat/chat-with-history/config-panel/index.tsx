import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import Form from './form'
import Button from '@/app/components/base/button'
import AppIcon from '@/app/components/base/app-icon'
import { MessageDotsCircle } from '@/app/components/base/icons/src/vender/solid/communication'
import { Edit02 } from '@/app/components/base/icons/src/vender/line/general'
import { Star06 } from '@/app/components/base/icons/src/vender/solid/shapes'
import { FootLogo } from '@/app/components/share/chat/welcome/massive-component'

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
    <div className='flex flex-col max-h-[80%] w-full max-w-[720px]'>
      <div
        className={`
          grow rounded-xl overflow-y-auto
          ${showConfigPanelBeforeChat && 'border-[0.5px] border-gray-100 shadow-lg'}
          ${!showConfigPanelBeforeChat && collapsed && 'border border-indigo-100'}
          ${!showConfigPanelBeforeChat && !collapsed && 'border-[0.5px] border-gray-100 shadow-lg'}
        `}
      >
        <div
          className={`
            flex flex-wrap px-6 py-4 rounded-t-xl bg-indigo-25
            ${isMobile && '!px-4 !py-3'}
          `}
        >
          {
            showConfigPanelBeforeChat && (
              <>
                <div className='flex items-center h-8 text-2xl font-semibold text-gray-800'>
                  <AppIcon
                    icon={appData?.site.icon}
                    background='transparent'
                    size='small'
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
                <Star06 className='mr-1 mt-1 w-4 h-4 text-indigo-600' />
                <div className='grow py-[3px] text-[13px] text-indigo-600 leading-[18px] font-medium'>
                  {t('share.chat.configStatusDes')}
                </div>
                <Button
                  variant='secondary-accent'
                  size='small'
                  className='shrink-0'
                  onClick={() => setCollapsed(false)}
                >
                  <Edit02 className='mr-1 w-3 h-3' />
                  {t('common.operation.edit')}
                </Button>
              </>
            )
          }
          {
            !showConfigPanelBeforeChat && !collapsed && (
              <>
                <Star06 className='mr-1 mt-1 w-4 h-4 text-indigo-600' />
                <div className='grow py-[3px] text-[13px] text-indigo-600 leading-[18px] font-medium'>
                  {t('share.chat.privatePromptConfigTitle')}
                </div>
              </>
            )
          }
        </div>
        {
          !collapsed && !showConfigPanelBeforeChat && (
            <div className='p-6 rounded-b-xl'>
              <Form />
              <div className={`pl-[136px] flex items-center ${isMobile && '!pl-0'}`}>
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
            <div className='p-6 rounded-b-xl'>
              <Form />
              <Button
                className={`${inputsForms.length && !isMobile && 'ml-[136px]'}`}
                variant='primary'
                size='large'
                onClick={handleStartChat}
              >
                <MessageDotsCircle className='mr-2 w-4 h-4 text-white' />
                {t('share.chat.startChat')}
              </Button>
            </div>
          )
        }
      </div>
      {
        showConfigPanelBeforeChat && (site || customConfig) && (
          <div className='mt-4 flex flex-wrap justify-between items-center py-2 text-xs text-gray-400'>
            {site?.privacy_policy
              ? <div className={`flex items-center ${isMobile && 'w-full justify-end'}`}>{t('share.chat.privacyPolicyLeft')}
                <a
                  className='text-gray-500 px-1'
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
                    <div className='flex items-center pr-3 space-x-3'>
                      <span className='uppercase'>{t('share.chat.powerBy')}</span>
                      {
                        customConfig?.replace_webapp_logo
                          ? <img src={customConfig?.replace_webapp_logo} alt='logo' className='block w-auto h-5' />
                          : <FootLogo />
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
