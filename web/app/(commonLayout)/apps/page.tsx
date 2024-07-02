import classNames from 'classnames'
import getConfig from 'next/config'
import style from '../list.module.css'
import Apps from './Apps'
import AppRemoteImport from './AppRemoteImport'
import { getLocaleOnServer, useTranslation as translate } from '@/i18n/server'
import Loading from '@/app/components/base/loading'

const { serverRuntimeConfig } = getConfig()

const AppList = async ({ searchParams }: any) => {
  const locale = getLocaleOnServer()
  const { t } = await translate(locale, 'app')

  const showRemoteImport = (remoteInstallUrl: string, allowedHosts: string[]) => {
    if (!remoteInstallUrl || !allowedHosts?.length)
      return false

    try {
      return allowedHosts.includes(new URL(remoteInstallUrl).hostname)
    }
    catch (_error) {
      return false
    }
  }

  if (showRemoteImport(searchParams.remoteInstallUrl, serverRuntimeConfig.apps?.importFromRemote?.allowedHosts)) {
    return (
      <>
        <div className="flex justify-center items-center relative w-full h-full bg-[#F0F2F7]">
          <div>
            <AppRemoteImport remoteInstallUrl={searchParams.remoteInstallUrl} />
            <Loading />
          </div>
        </div>
      </>
    )
  }

  return (
    <div className='relative flex flex-col overflow-y-auto bg-gray-100 shrink-0 h-0 grow'>
      <Apps />
      <footer className='px-12 py-6 grow-0 shrink-0'>
        <h3 className='text-xl font-semibold leading-tight text-gradient'>{t('join')}</h3>
        <p className='mt-1 text-sm font-normal leading-tight text-gray-700'>{t('communityIntro')}</p>
        <div className='flex items-center gap-2 mt-3'>
          <a className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://github.com/langgenius/dify'><span className={classNames(style.socialMediaIcon, style.githubIcon)} /></a>
          <a className={style.socialMediaLink} target='_blank' rel='noopener noreferrer' href='https://discord.gg/FngNHpbcY7'><span className={classNames(style.socialMediaIcon, style.discordIcon)} /></a>
        </div>
      </footer>
    </div >
  )
}

export default AppList
