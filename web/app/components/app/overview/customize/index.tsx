'use client'
import type { FC } from 'react'
import React from 'react'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { AppMode } from '@/types/app'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import Tag from '@/app/components/base/tag'
import { LanguagesSupported } from '@/i18n/language'

type IShareLinkProps = {
  isShow: boolean
  onClose: () => void
  linkUrl: string
  api_base_url: string
  appId: string
  mode: AppMode
}

const StepNum: FC<{ children: React.ReactNode }> = ({ children }) =>
  <div className='mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-util-colors-blue-blue-50 text-text-accent'>
    {children}
  </div>

const GithubIcon = ({ className }: { className: string }) => {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M5.80078 13.7109C5.80078 13.6406 5.73047 13.5703 5.625 13.5703C5.51953 13.5703 5.44922 13.6406 5.44922 13.7109C5.44922 13.7812 5.51953 13.8516 5.625 13.8164C5.73047 13.8164 5.80078 13.7812 5.80078 13.7109ZM4.71094 13.5352C4.71094 13.6055 4.78125 13.7109 4.88672 13.7109C4.95703 13.7461 5.0625 13.7109 5.09766 13.6406C5.09766 13.5703 5.0625 13.5 4.95703 13.4648C4.85156 13.4297 4.74609 13.4648 4.71094 13.5352ZM6.29297 13.5C6.1875 13.5 6.11719 13.5703 6.11719 13.6758C6.11719 13.7461 6.22266 13.7812 6.32812 13.7461C6.43359 13.7109 6.50391 13.6758 6.46875 13.6055C6.46875 13.5352 6.36328 13.4648 6.29297 13.5ZM8.57812 0C3.72656 0 0 3.72656 0 8.57812C0 12.4805 2.42578 15.8203 5.94141 17.0156C6.39844 17.0859 6.53906 16.8047 6.53906 16.5938C6.53906 16.3477 6.53906 15.1523 6.53906 14.4141C6.53906 14.4141 4.07812 14.9414 3.55078 13.3594C3.55078 13.3594 3.16406 12.3398 2.60156 12.0938C2.60156 12.0938 1.79297 11.5312 2.63672 11.5312C2.63672 11.5312 3.51562 11.6016 4.00781 12.4453C4.78125 13.8164 6.04688 13.4297 6.57422 13.1836C6.64453 12.6211 6.85547 12.2344 7.13672 11.9883C5.16797 11.7773 3.16406 11.4961 3.16406 8.12109C3.16406 7.13672 3.44531 6.67969 4.00781 6.04688C3.90234 5.80078 3.62109 4.88672 4.11328 3.65625C4.81641 3.44531 6.53906 4.60547 6.53906 4.60547C7.24219 4.39453 7.98047 4.32422 8.71875 4.32422C9.49219 4.32422 10.2305 4.39453 10.9336 4.60547C10.9336 4.60547 12.6211 3.41016 13.3594 3.65625C13.8516 4.88672 13.5352 5.80078 13.4648 6.04688C14.0273 6.67969 14.3789 7.13672 14.3789 8.12109C14.3789 11.4961 12.3047 11.7773 10.3359 11.9883C10.6523 12.2695 10.9336 12.7969 10.9336 13.6406C10.9336 14.8008 10.8984 16.2773 10.8984 16.5586C10.8984 16.8047 11.0742 17.0859 11.5312 16.9805C15.0469 15.8203 17.4375 12.4805 17.4375 8.57812C17.4375 3.72656 13.4648 0 8.57812 0ZM3.41016 12.1289C3.33984 12.1641 3.375 12.2695 3.41016 12.3398C3.48047 12.375 3.55078 12.4102 3.62109 12.375C3.65625 12.3398 3.65625 12.2344 3.58594 12.1641C3.51562 12.1289 3.44531 12.0938 3.41016 12.1289ZM3.02344 11.8477C2.98828 11.918 3.02344 11.9531 3.09375 11.9883C3.16406 12.0234 3.23438 12.0234 3.26953 11.9531C3.26953 11.918 3.23438 11.8828 3.16406 11.8477C3.09375 11.8125 3.05859 11.8125 3.02344 11.8477ZM4.14844 13.1133C4.11328 13.1484 4.11328 13.2539 4.21875 13.3242C4.28906 13.3945 4.39453 13.4297 4.42969 13.3594C4.46484 13.3242 4.46484 13.2188 4.39453 13.1484C4.32422 13.0781 4.21875 13.043 4.14844 13.1133ZM3.76172 12.5859C3.69141 12.6211 3.69141 12.7266 3.76172 12.7969C3.83203 12.8672 3.90234 12.9023 3.97266 12.8672C4.00781 12.832 4.00781 12.7266 3.97266 12.6562C3.90234 12.5859 3.83203 12.5508 3.76172 12.5859Z" fill="#1F2A37" />
    </svg>
  )
}

const prefixCustomize = 'appOverview.overview.appInfo.customize'

const CustomizeModal: FC<IShareLinkProps> = ({
  isShow,
  onClose,
  appId,
  api_base_url,
  mode,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const isChatApp = mode === 'chat' || mode === 'advanced-chat'

  return <Modal
    title={t(`${prefixCustomize}.title`)}
    description={t(`${prefixCustomize}.explanation`)}
    isShow={isShow}
    onClose={onClose}
    className='w-[640px] !max-w-2xl'
    closable={true}
  >
    <div className='mt-4 w-full rounded-lg border-[0.5px] border-components-panel-border px-6 py-5'>
      <Tag bordered={true} hideBg={true} className='border-text-accent-secondary uppercase text-text-accent-secondary'>{t(`${prefixCustomize}.way`)} 1</Tag>
      <p className='system-sm-medium my-2 text-text-secondary'>{t(`${prefixCustomize}.way1.name`)}</p>
      <div className='flex py-4'>
        <StepNum>1</StepNum>
        <div className='flex flex-col'>
          <div className='text-text-primary'>{t(`${prefixCustomize}.way1.step1`)}</div>
          <div className='mb-2 mt-1 text-xs text-text-tertiary'>{t(`${prefixCustomize}.way1.step1Tip`)}</div>
          <a href={`https://github.com/langgenius/${isChatApp ? 'webapp-conversation' : 'webapp-text-generator'}`} target='_blank' rel='noopener noreferrer'>
            <Button><GithubIcon className='mr-2 text-text-secondary' />{t(`${prefixCustomize}.way1.step1Operation`)}</Button>
          </a>
        </div>
      </div>
      <div className='flex pt-4'>
        <StepNum>2</StepNum>
        <div className='flex flex-col'>
          <div className='text-text-primary'>{t(`${prefixCustomize}.way1.step3`)}</div>
          <div className='mb-2 mt-1 text-xs text-text-tertiary'>{t(`${prefixCustomize}.way1.step2Tip`)}</div>
          <a href="https://vercel.com/docs/concepts/deployments/git/vercel-for-github" target='_blank' rel='noopener noreferrer'>
            <Button>
              <div className='mr-1.5 border-b-[12px] border-l-[7px] border-r-[7px] border-t-0 border-solid border-text-primary border-l-transparent border-r-transparent border-t-transparent'></div>
              <span>{t(`${prefixCustomize}.way1.step2Operation`)}</span>
            </Button>
          </a>
        </div>
      </div>
      <div className='flex py-4'>
        <StepNum>3</StepNum>
        <div className='flex w-full flex-col overflow-hidden'>
          <div className='text-text-primary'>{t(`${prefixCustomize}.way1.step3`)}</div>
          <div className='mb-2 mt-1 text-xs text-text-tertiary'>{t(`${prefixCustomize}.way1.step3Tip`)}</div>
          <pre className='box-border select-text overflow-x-scroll rounded-lg border-[0.5px] border-components-panel-border bg-background-section px-4 py-3 text-xs font-medium text-text-secondary'>
            NEXT_PUBLIC_APP_ID={`'${appId}'`} <br />
            NEXT_PUBLIC_APP_KEY={'\'<Web API Key From Dify>\''} <br />
            NEXT_PUBLIC_API_URL={`'${api_base_url}'`}
          </pre>
        </div>
      </div>

    </div>
    <div className='mt-4 w-full rounded-lg border-[0.5px] border-components-panel-border px-6 py-5'>
      <Tag bordered={true} hideBg={true} className='border-text-accent-secondary uppercase text-text-accent-secondary'>{t(`${prefixCustomize}.way`)} 2</Tag>
      <p className='system-sm-medium my-2 text-text-secondary'>{t(`${prefixCustomize}.way2.name`)}</p>
      <Button
        className='mt-2'
        onClick={() =>
          window.open(
            `https://docs.dify.ai/${locale !== LanguagesSupported[1]
              ? 'user-guide/launching-dify-apps/developing-with-apis'
              : `${locale.toLowerCase()}/guides/application-publishing/developing-with-apis`
            }`,
            '_blank',
          )
        }
      >
        <span className='text-sm text-text-secondary'>{t(`${prefixCustomize}.way2.operation`)}</span>
        <ArrowTopRightOnSquareIcon className='ml-1 h-4 w-4 shrink-0 text-text-secondary' />
      </Button>
    </div>
  </Modal>
}

export default CustomizeModal
