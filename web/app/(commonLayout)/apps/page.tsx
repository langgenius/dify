'use client'
import { useTranslation } from 'react-i18next'
import { RiDiscordFill, RiGithubFill } from '@remixicon/react'
import Link from 'next/link'
import style from '../list.module.css'
import Apps from './Apps'
import { useEducationInit } from '@/app/education-apply/hooks'
import { useGlobalPublicStore } from '@/context/global-public-context'

const AppList = () => {
  const { t } = useTranslation()
  useEducationInit()
  const { systemFeatures } = useGlobalPublicStore()
  return (
    <div className='relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body'>
      <Apps />
      {!systemFeatures.branding.enabled && <footer className='shrink-0 grow-0 px-12 py-6'>
        <h3 className='text-gradient text-xl font-semibold leading-tight'>{t('app.join')}</h3>
        <p className='system-sm-regular mt-1 text-text-tertiary'>{t('app.communityIntro')}</p>
        <div className='mt-3 flex items-center gap-2'>
          <Link className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://github.com/langgenius/dify'>
            <RiGithubFill className='h-5 w-5 text-text-tertiary' />
          </Link>
          <Link className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://discord.gg/FngNHpbcY7'>
            <RiDiscordFill className='h-5 w-5 text-text-tertiary' />
          </Link>
        </div>
      </footer>}
    </div >
  )
}

export default AppList
