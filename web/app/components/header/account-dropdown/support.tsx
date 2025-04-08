import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
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

  return <Menu as="div" className="relative h-full w-full">
    {
      ({ open }) => (
        <>
          <MenuButton className={
            cn('group flex h-9 w-full items-center gap-1 rounded-lg py-2 pl-3 pr-2 hover:bg-state-base-hover',
              open && 'bg-state-base-hover',
            )}>
            <RiQuestionLine className='size-4 shrink-0 text-text-tertiary' />
            <div className='system-md-regular grow px-1 text-left text-text-secondary'>{t('common.userProfile.support')}</div>
            <RiArrowRightSLine className='size-[14px] shrink-0 text-text-tertiary' />
          </MenuButton>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <MenuItems
              className={cn(
                `absolute top-[1px] z-10 max-h-[70vh] w-[216px] origin-top-right -translate-x-full divide-y divide-divider-subtle overflow-y-scroll
                rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px] focus:outline-none
              `,
              )}
            >
              <div className="px-1 py-1">
                {canEmailSupport && <MenuItem>
                  <a
                    className={cn(itemClassName, 'group justify-between',
                      'data-[active]:bg-state-base-hover',
                    )}
                    href={mailToSupport(userProfile.email, plan.type, langeniusVersionInfo.current_version)}
                    target='_blank' rel='noopener noreferrer'>
                    <RiMailSendLine className='size-4 shrink-0 text-text-tertiary' />
                    <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.emailSupport')}</div>
                    <RiArrowRightUpLine className='size-[14px] shrink-0 text-text-tertiary' />
                  </a>
                </MenuItem>}
                <MenuItem>
                  <Link
                    className={cn(itemClassName, 'group justify-between',
                      'data-[active]:bg-state-base-hover',
                    )}
                    href='https://github.com/langgenius/dify/discussions/categories/feedbacks'
                    target='_blank' rel='noopener noreferrer'>
                    <RiFeedbackLine className='size-4 shrink-0 text-text-tertiary' />
                    <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.communityFeedback')}</div>
                    <RiArrowRightUpLine className='size-[14px] shrink-0 text-text-tertiary' />
                  </Link>
                </MenuItem>
                <MenuItem>
                  <Link
                    className={cn(itemClassName, 'group justify-between',
                      'data-[active]:bg-state-base-hover',
                    )}
                    href='https://discord.gg/5AEfbxcd9k'
                    target='_blank' rel='noopener noreferrer'>
                    <RiDiscordLine className='size-4 shrink-0 text-text-tertiary' />
                    <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.community')}</div>
                    <RiArrowRightUpLine className='size-[14px] shrink-0 text-text-tertiary' />
                  </Link>
                </MenuItem>
              </div>
            </MenuItems>
          </Transition>
        </>
      )
    }
  </Menu>
}
