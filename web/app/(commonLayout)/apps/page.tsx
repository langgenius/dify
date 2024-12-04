'use client'
import { useContextSelector } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import style from '../list.module.css'
import Apps from './Apps'
import classNames from '@/utils/classnames'
import AppContext from '@/context/app-context'
import { LicenseStatus } from '@/types/feature'

const AppList = () => {
  const { t } = useTranslation()
  const systemFeatures = useContextSelector(AppContext, v => v.systemFeatures)

  return (
    <div className='relative flex flex-col overflow-y-auto bg-gray-100 shrink-0 h-0 grow'>
      <Apps />
      {systemFeatures.license.status === LicenseStatus.NONE && <footer className='px-12 py-6 grow-0 shrink-0'>
        <h3 className='text-xl font-semibold leading-tight text-gradient'>{t('app.join')}</h3>
        <p className='mt-1 text-sm font-normal leading-tight text-gray-700'>{t('app.communityIntro')}</p>
        <div className='flex items-center gap-2 mt-3'>
          <a className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://github.com/langgenius/dify'><span className={classNames(style.socialMediaIcon, style.githubIcon)} /></a>
          <a className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://discord.gg/FngNHpbcY7'><span className={classNames(style.socialMediaIcon, style.discordIcon)} /></a>
        </div>
      </footer>}
    </div >
  )
}

export default AppList
