import classNames from 'classnames'
import style from '../list.module.css'
import Apps from './Apps'
import { getLocaleOnServer } from '@/i18n/server'
import { useTranslation } from '@/i18n/i18next-serverside-config'

const AppList = async () => {
  const locale = getLocaleOnServer()
  const { t } = await useTranslation(locale, 'app')

  return (
    <div className='flex flex-col overflow-auto bg-gray-100 shrink-0 grow'>
      <Apps />
      <footer className='px-12 py-6 grow-0 shrink-0'>
        <h3 className='text-xl font-semibold leading-tight text-gradient'>{t('join')}</h3>
        <p className='mt-1 text-sm font-normal leading-tight text-gray-700'>{t('communityIntro')}</p>
        {/* <p className='mt-3 text-sm'> */}
        {/*  <a className='inline-flex items-center gap-1 link' target='_blank' href={`https://docs.dify.ai${locale === 'en' ? '' : '/v/zh-hans'}/community/product-roadmap`}> */}
        {/*    {t('roadmap')} */}
        {/*    <span className={style.linkIcon} /> */}
        {/*  </a> */}
        {/* </p> */}
        <div className='flex items-center gap-2 mt-3'>
          <a className={style.socialMediaLink} target='_blank' href='https://github.com/langgenius/dify'><span className={classNames(style.socialMediaIcon, style.githubIcon)} /></a>
          <a className={style.socialMediaLink} target='_blank' href='https://discord.gg/FngNHpbcY7'><span className={classNames(style.socialMediaIcon, style.discordIcon)} /></a>
        </div>
      </footer>
    </div >
  )
}

export default AppList
