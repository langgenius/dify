import { Menu, Transition } from '@headlessui/react'
import { RiArrowRightSLine, RiArrowRightUpLine, RiDiscordLine, RiFeedbackLine, RiMailSendLine, RiQuestionLine } from '@remixicon/react'
import { Fragment } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { mailToSupport } from '../utils/util'
import cn from '@/utils/classnames'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'

export default function Support() {
  const itemClassName = `
  flex items-center w-full h-9 pl-3 pr-2 text-text-secondary system-md-regular
  rounded-lg hover:bg-state-base-hover cursor-pointer gap-1
`
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { userProfile, langeniusVersionInfo } = useAppContext()
  const canEmailSupport = plan.type === Plan.professional || plan.type === Plan.team || plan.type === Plan.enterprise

  return <Menu as="div" className="relative w-full h-full">
    {
      ({ open }) => (
        <>
          <Menu.Button className={
            cn('flex items-center pl-3 pr-2 py-2 h-9 w-full group hover:bg-state-base-hover rounded-lg gap-1',
              open && 'bg-state-base-hover',
            )}>
            <RiQuestionLine className='flex-shrink-0 size-4 text-text-tertiary' />
            <div className='flex-grow text-left system-md-regular text-text-secondary px-1'>{t('common.userProfile.support')}</div>
            <RiArrowRightSLine className='shrink-0 size-[14px] text-text-tertiary' />
          </Menu.Button>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <Menu.Items
              className={cn(
                `absolute top-[1px] w-[216px] max-h-[70vh] overflow-y-scroll z-10 bg-components-panel-bg-blur backdrop-blur-[5px] border-[0.5px] border-components-panel-border
                divide-y divide-divider-subtle origin-top-right rounded-xl focus:outline-none shadow-lg -translate-x-full
              `,
              )}
            >
              <div className="px-1 py-1">
                {canEmailSupport && <Menu.Item>
                  {({ active }) => <a
                    className={cn(itemClassName, 'group justify-between',
                      active && 'bg-state-base-hover',
                    )}
                    href={mailToSupport(userProfile.email, plan.type, langeniusVersionInfo.current_version)}
                    target='_blank' rel='noopener noreferrer'>
                    <RiMailSendLine className='flex-shrink-0 size-4 text-text-tertiary' />
                    <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.emailSupport')}</div>
                    <RiArrowRightUpLine className='flex-shrink-0 size-[14px] text-text-tertiary' />
                  </a>}
                </Menu.Item>}
                <Menu.Item>
                  {({ active }) => <Link
                    className={cn(itemClassName, 'group justify-between',
                      active && 'bg-state-base-hover',
                    )}
                    href='https://github.com/langgenius/dify/discussions/categories/feedbacks'
                    target='_blank' rel='noopener noreferrer'>
                    <RiFeedbackLine className='flex-shrink-0 size-4 text-text-tertiary' />
                    <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.communityFeedback')}</div>
                    <RiArrowRightUpLine className='flex-shrink-0 size-[14px] text-text-tertiary' />
                  </Link>}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => <Link
                    className={cn(itemClassName, 'group justify-between',
                      active && 'bg-state-base-hover',
                    )}
                    href='https://discord.gg/5AEfbxcd9k'
                    target='_blank' rel='noopener noreferrer'>
                    <RiDiscordLine className='flex-shrink-0 size-4 text-text-tertiary' />
                    <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.community')}</div>
                    <RiArrowRightUpLine className='flex-shrink-0 size-[14px] text-text-tertiary' />
                  </Link>}
                </Menu.Item>
              </div>
            </Menu.Items>
          </Transition>
        </>
      )
    }
  </Menu>
}
