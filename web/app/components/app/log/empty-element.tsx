'use client'
import type { FC, SVGProps } from 'react'
import React from 'react'
import Link from 'next/link'
import { Trans, useTranslation } from 'react-i18next'
import { basePath } from '@/utils/var'
import { getRedirectionPath } from '@/utils/app-redirection'
import type { App, AppMode } from '@/types/app'

const ThreeDotsIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path d="M5 6.5V5M8.93934 7.56066L10 6.5M10.0103 11.5H11.5103" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

const EmptyElement: FC<{ appDetail: App }> = ({ appDetail }) => {
  const { t } = useTranslation()

  const getWebAppType = (appType: AppMode) => {
    if (appType !== 'completion' && appType !== 'workflow')
      return 'chat'
    return appType
  }

  return <div className='flex h-full items-center justify-center'>
    <div className='box-border h-fit w-[560px] rounded-2xl bg-background-section-burn px-5 py-4'>
      <span className='system-md-semibold text-text-secondary'>{t('appLog.table.empty.element.title')}<ThreeDotsIcon className='relative -left-1.5 -top-3 inline text-text-secondary' /></span>
      <div className='system-sm-regular mt-2 text-text-tertiary'>
        <Trans
          i18nKey="appLog.table.empty.element.content"
          components={{
            shareLink: <Link href={`${appDetail.site.app_base_url}${basePath}/${getWebAppType(appDetail.mode)}/${appDetail.site.access_token}`} className='text-util-colors-blue-blue-600' target='_blank' rel='noopener noreferrer' />,
            testLink: <Link href={getRedirectionPath(true, appDetail)} className='text-util-colors-blue-blue-600' />,
          }}
        />
      </div>
    </div>
  </div>
}

export default React.memo(EmptyElement)
