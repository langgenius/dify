'use client'
import { useTranslation } from 'react-i18next'
import s from './secret-key/style.module.css'
import Doc from '@/app/components/develop/doc'
import Loading from '@/app/components/base/loading'
import InputCopy from '@/app/components/develop/secret-key/input-copy'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'
import { useStore as useAppStore } from '@/app/components/app/store'

type IDevelopMainProps = {
  appId: string
}

const DevelopMain = ({ appId }: IDevelopMainProps) => {
  const appDetail = useAppStore(state => state.appDetail)
  const { t } = useTranslation()

  if (!appDetail) {
    return (
      <div className='flex h-full items-center justify-center bg-white'>
        <Loading />
      </div>
    )
  }

  return (
    <div className='relative flex h-full flex-col overflow-hidden'>
      <div className='flex shrink-0 items-center justify-between border-b border-solid border-b-gray-100 px-6 py-2'>
        <div className='text-lg font-medium text-gray-900'></div>
        <div className='flex flex-wrap items-center gap-y-1'>
          <InputCopy className='mr-1 w-52 shrink-0 sm:w-80' value={appDetail.api_base_url}>
            <div className={`ml-2 shrink-0 rounded-[6px] border border-solid border-gray-200 px-2 py-0.5 text-[0.625rem] text-gray-500 ${s.customApi}`}>
              {t('appApi.apiServer')}
            </div>
          </InputCopy>
          <div className={`mr-2 flex h-9 items-center rounded-lg 
                        px-3 text-[13px]  font-normal ${appDetail.enable_api ? 'bg-green-50 text-green-500' : 'bg-yellow-50 text-yellow-500'}`}>
            <div className='mr-1'>{t('appApi.status')}</div>
            <div className='font-semibold'>{appDetail.enable_api ? `${t('appApi.ok')}` : `${t('appApi.disabled')}`}</div>
          </div>
          <SecretKeyButton className='shrink-0' appId={appId} />
        </div>
      </div>
      <div className='grow overflow-auto px-4 py-4 sm:px-10'>
        <Doc appDetail={appDetail} />
      </div>
    </div>
  )
}

export default DevelopMain
