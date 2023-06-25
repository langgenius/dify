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
      </footer>
    </div >
  )
}

export default AppList
