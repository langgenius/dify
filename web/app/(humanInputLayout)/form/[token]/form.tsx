'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useParams } from 'next/navigation'
import {
  RiCheckboxCircleFill,
  RiInformation2Fill,
} from '@remixicon/react'
import AppIcon from '@/app/components/base/app-icon'
import { Markdown } from '@/app/components/base/markdown'
import Button, { } from '@/app/components/base/button'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'

import cn from '@/utils/classnames'

import { MOCK_DATA } from './mock'

const success = true

const expired = true

const submitted = true

const FormContent = () => {
  const { t } = useTranslation()

  const { token } = useParams()
  useDocumentTitle('')

  const { site } = MOCK_DATA.site
  const { form_content, user_actions, timeout, timeout_unit } = MOCK_DATA

  const getButtonStyle = (style: UserActionButtonType) => {
    if (style === UserActionButtonType.Primary)
      return 'primary'
    if (style === UserActionButtonType.Default)
      return 'secondary'
    if (style === UserActionButtonType.Accent)
      return 'secondary-accent'
    if (style === UserActionButtonType.Ghost)
      return 'ghost'
  }

  if (success) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className='min-w-[480px] max-w-[640px]'>
          <div className='border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm'>
            <div className='h-[56px] w-[56px] shrink-0 rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3'>
              <RiCheckboxCircleFill className='h-8 w-8 text-text-success' />
            </div>
            <div className='grow'>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.thanks')}</div>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.recorded')}</div>
            </div>
            <div className='system-2xs-regular-uppercase shrink-0 text-text-tertiary'>{t('share.humanInput.submissionID', { id: token })}</div>
          </div>
          <div className='flex flex-row-reverse px-2 py-3'>
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
              <DifyLogo size='small' />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (expired) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className='min-w-[480px] max-w-[640px]'>
          <div className='border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm'>
            <div className='h-[56px] w-[56px] shrink-0 rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3'>
              <RiInformation2Fill className='h-8 w-8 text-text-accent' />
            </div>
            <div className='grow'>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.sorry')}</div>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.expired')}</div>
            </div>
            <div className='system-2xs-regular-uppercase shrink-0 text-text-tertiary'>{t('share.humanInput.submissionID', { id: token })}</div>
          </div>
          <div className='flex flex-row-reverse px-2 py-3'>
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
              <DifyLogo size='small' />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className='min-w-[480px] max-w-[640px]'>
          <div className='border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm'>
            <div className='h-[56px] w-[56px] shrink-0 rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3'>
              <RiInformation2Fill className='h-8 w-8 text-text-accent' />
            </div>
            <div className='grow'>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.sorry')}</div>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.completed')}</div>
            </div>
            <div className='system-2xs-regular-uppercase shrink-0 text-text-tertiary'>{t('share.humanInput.submissionID', { id: token })}</div>
          </div>
          <div className='flex flex-row-reverse px-2 py-3'>
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
              <DifyLogo size='small' />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('mx-auto flex h-full w-full max-w-[720px] flex-col items-center')}>
      <div className='mt-4 flex w-full shrink-0 items-center gap-3 py-3'>
        <AppIcon
          size='large'
          iconType={site.icon_type as any}
          icon={site.icon}
          background={site.icon_background}
          imageUrl={site.icon_url}
        />
        <div className='system-xl-semibold grow text-text-primary'>{site.title}</div>
      </div>
      <div className='h-0 w-full grow overflow-y-auto'>
        <div className='border-components-divider-subtle rounded-[20px] border bg-chat-bubble-bg p-4 shadow-lg backdrop-blur-sm'>
          <Markdown content={form_content || ''} />
          <div className='flex flex-wrap gap-1 py-1'>
            {user_actions.map((action: any) => (
              <Button key={action.id} variant={getButtonStyle(action.button_style) as any}>
                {action.title}
              </Button>
            ))}
          </div>
          <div className='system-xs-regular mt-1 text-text-tertiary'>
            {timeout_unit === 'day' ? t('share.humanInput.timeoutDay', { count: timeout }) : t('share.humanInput.timeoutHour', { count: timeout })}
          </div>
        </div>
        <div className='flex flex-row-reverse px-2 py-3'>
          <div className={cn(
            'flex shrink-0 items-center gap-1.5 px-1',
          )}>
            <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
            <DifyLogo size='small' />
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(FormContent)
