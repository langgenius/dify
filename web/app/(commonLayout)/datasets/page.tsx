import classNames from 'classnames'
import { getLocaleOnServer } from '@/i18n/server'
import { useTranslation } from '@/i18n/i18next-serverside-config'
import Datasets from './Datasets'
import DatasetFooter from './DatasetFooter'

const AppList = async () => {
  const locale = getLocaleOnServer()
  const { t } = await useTranslation(locale, 'dataset')

  return (
    <div className='flex flex-col overflow-auto bg-gray-100 shrink-0 grow'>
      <Datasets />
      <DatasetFooter />
    </div >
  )
}

export const metadata = {
  title: 'Datasets - Dify',
}

export default AppList
