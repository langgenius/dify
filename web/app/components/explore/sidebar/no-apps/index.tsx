'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import useTheme from '@/hooks/use-theme'
import cn from '@/utils/classnames'
import { Theme } from '@/types/app'

const i18nPrefix = 'explore.sidebar.noApps'

const NoApps: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  return (
    <div className='rounded-xl bg-background-default-subtle p-4'>
      <div className={cn('h-[35px] w-[86px] bg-contain bg-center bg-no-repeat', theme === Theme.dark ? s.dark : s.light)}></div>
      <div className='system-sm-semibold mt-2 text-text-secondary'>{t(`${i18nPrefix}.title`)}</div>
      <div className='system-xs-regular my-1 text-text-tertiary'>{t(`${i18nPrefix}.description`)}</div>
      <a className='system-xs-regular text-text-accent' target='_blank' rel='noopener noreferrer' href='https://docs.dify.ai/en/guides/application-publishing/launch-your-webapp-quickly/README'>{t(`${i18nPrefix}.learnMore`)}</a>
    </div>
  )
}
export default React.memo(NoApps)
