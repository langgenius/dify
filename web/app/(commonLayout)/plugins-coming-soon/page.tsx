import s from './page.module.css'
import { getLocaleOnServer } from '@/i18n/server'
import { useTranslation } from '@/i18n/i18next-serverside-config'

const PluginsComingSoon = async () => {
  const locale = getLocaleOnServer()
  const { t } = await useTranslation(locale, 'common')

  return (
    <div className='flex justify-center items-center w-full h-full bg-gray-100'>
      <div className={s.bg}>
        <div className={s.tag} />
        <div className={s.text}>{t('menus.pluginsTips')}</div>
      </div>
    </div >
  )
}

export default PluginsComingSoon
