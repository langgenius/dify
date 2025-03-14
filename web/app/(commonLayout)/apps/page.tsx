'use client'
import { useTranslation } from 'react-i18next'
import { RiDiscordFill, RiGithubFill } from '@remixicon/react'
import Link from 'next/link'
import style from '../list.module.css'
import Apps from './Apps'
import { useGlobalPublicStore } from '@/context/global-public-context'
import useDocumentTitle from '@/hooks/use-document-title'

const AppList = () => {
  const { t } = useTranslation()
  const { systemFeatures } = useGlobalPublicStore()
  useDocumentTitle(t('common.menus.apps'))
  return (
    <div className='relative flex flex-col overflow-y-auto bg-background-body shrink-0 h-0 grow'>
      <Apps />
      {!systemFeatures.branding.enabled && <footer className='px-12 py-6 grow-0 shrink-0'>
        <h3 className='text-xl font-semibold leading-tight text-gradient'>{t('app.join')}</h3>
        <p className='mt-1 system-sm-regular text-text-tertiary'>{t('app.communityIntro')}</p>
        <div className='flex items-center gap-2 mt-3'>
          <Link className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://github.com/langgenius/dify'>
            <RiGithubFill className='w-5 h-5 text-text-tertiary' />
          </Link>
          <Link className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://discord.gg/FngNHpbcY7'>
            <RiDiscordFill className='w-5 h-5 text-text-tertiary' />
          </Link>
        </div>
      </footer>}
    </div >
  )
}

export default AppList
