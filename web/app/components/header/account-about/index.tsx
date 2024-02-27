'use client'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import Link from 'next/link'
import { useContext } from 'use-context-selector'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import type { LangGeniusVersionResponse } from '@/models/common'
import { IS_CE_EDITION } from '@/config'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'
import LogoSite from '@/app/components/base/logo/logo-site'

type IAccountSettingProps = {
  langeniusVersionInfo: LangGeniusVersionResponse
  onCancel: () => void
}
const buttonClassName = `
shrink-0 flex items-center h-8 px-3 rounded-lg border border-gray-200
text-xs text-gray-800 font-medium
`
export default function AccountAbout({
  langeniusVersionInfo,
  onCancel,
}: IAccountSettingProps) {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const isLatest = langeniusVersionInfo.current_version === langeniusVersionInfo.latest_version

  return (
    <Modal
      isShow
      onClose={() => { }}
      className={s.modal}
    >
      <div className='relative pt-4'>
        <div className='absolute -top-2 -right-4 flex justify-center items-center w-8 h-8 cursor-pointer' onClick={onCancel}>
          <XClose className='w-4 h-4 text-gray-500' />
        </div>
        <div>
          <LogoSite className='mx-auto mb-2' />
          <div className='mb-3 text-center text-xs font-normal text-gray-500'>Version {langeniusVersionInfo?.current_version}</div>
          <div className='mb-4 text-center text-xs font-normal text-gray-700'>
            <div>© 2024 AiConec, Inc., Contributors.</div>
          </div>
        </div>
        <div className='mb-4 -mx-8 h-[0.5px] bg-gray-200' />
        <div className='flex justify-between items-center'>
          <div className='text-xs font-medium text-gray-800'>
            {
              isLatest
                ? t('common.about.latestAvailable', { version: langeniusVersionInfo.latest_version })
                : t('common.about.nowAvailable', { version: langeniusVersionInfo.latest_version })
            }
          </div>
          <div className='flex items-center'>
            {
              !isLatest && !IS_CE_EDITION && (
                <Link
                  className={classNames(buttonClassName, 'text-primary-600')}
                  href={langeniusVersionInfo.release_notes}
                  target='_blank' rel='noopener noreferrer'
                >
                  {t('common.about.updateNow')}
                </Link>
              )
            }
          </div>
        </div>
      </div>
    </Modal>
  )
}
