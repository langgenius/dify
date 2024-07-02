'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getRedirection } from '@/utils/app-redirection'
import { importApp } from '@/service/apps'
import { useAppContext } from '@/context/app-context'

type AppRemoteImportProps = {
  remoteInstallUrl: string
}

const AppRemoteImport = ({ remoteInstallUrl }: AppRemoteImportProps) => {
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()
  const { replace } = useRouter()
  const { isCurrentWorkspaceManager } = useAppContext()

  useEffect(() => {
    if (!remoteInstallUrl)
      return

    fetch(remoteInstallUrl)
      .then(response => response.text())
      .then(data => importApp({ data }))
      .then(app => getRedirection(isCurrentWorkspaceManager, app, replace))
      .catch(() => {
        setError(t('app.installingAppFailed'))
        setTimeout(() => {
          replace('/apps')
        }, 3000)
      })
  }, [remoteInstallUrl])

  if (error) {
    return (
      <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center bg-black bg-opacity-50">
        <div className="px-3 py-[10px] rounded-lg !bg-[#fef3f2] border-[0.5px] border-[rbga(0,0,0,0.05)] shadow-xs">
          <div className=" leading-[18px] text-[#d92d20]">{error}</div>
        </div>
      </div>
    )
  }

  return <p className="m-2">{t('app.installingApp')}</p>
}

export default AppRemoteImport
