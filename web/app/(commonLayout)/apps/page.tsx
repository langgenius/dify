'use client'
import { useContextSelector } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { RiDiscordFill, RiGithubFill } from '@remixicon/react'
import Link from 'next/link'
import style from '../list.module.css'
import Apps from './Apps'
import AppContext from '@/context/app-context'
import { LicenseStatus } from '@/types/feature'

const AppList = () => {
  const { t } = useTranslation()
  const systemFeatures = useContextSelector(AppContext, v => v.systemFeatures)

  return (
    <div className='bg-background-body relative flex h-0 shrink-0 grow flex-col overflow-y-auto'>
      <Apps />
      {systemFeatures.license.status === LicenseStatus.NONE && <footer className='shrink-0 grow-0 px-12 py-6'>
        <h3 className='text-gradient text-xl font-semibold leading-tight'>{t('app.join')}</h3>
        <p className='system-sm-regular text-text-tertiary mt-1'>{t('app.communityIntro')}</p>
        <div className='mt-3 flex items-center gap-2'>
          <Link className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://github.com/langgenius/dify'>
            <RiGithubFill className='text-text-tertiary h-5 w-5' />
          </Link>
          <Link className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://discord.gg/FngNHpbcY7'>
            <RiDiscordFill className='text-text-tertiary h-5 w-5' />
          </Link>
        </div>
      </footer>}
    </div >
  )
}

export default AppList
