'use client'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import dayjs from 'dayjs'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import type { LangGeniusVersionResponse } from '@/models/common'
import { IS_CE_EDITION } from '@/config'
import LogoSite from '@/app/components/base/logo/logo-site'
import { noop } from 'lodash-es'

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
  const isLatest = langeniusVersionInfo.current_version === langeniusVersionInfo.latest_version

  return (
    <Modal
      isShow
      onClose={noop}
      className='!w-[480px] !max-w-[480px] !px-6 !py-4'
    >
      <div className='relative pt-4'>
        <div className='absolute -right-4 -top-2 flex h-8 w-8 cursor-pointer items-center justify-center' onClick={onCancel}>
          <RiCloseLine className='h-4 w-4 text-text-tertiary' />
        </div>
        <div>
          <LogoSite className='mx-auto mb-2' />
          <div className='mb-3 text-center text-xs font-normal text-text-tertiary'>Version {langeniusVersionInfo?.current_version}</div>
          <div className='mb-4 text-center text-xs font-normal text-text-secondary'>
            <div>© {dayjs().year()} LangGenius, Inc., Contributors.</div>
            <div className='text-text-accent'>
              {
                IS_CE_EDITION
                  ? <Link href={'https://github.com/langgenius/dify/blob/main/LICENSE'} target='_blank' rel='noopener noreferrer'>Open Source License</Link>
                  : <>
                    <Link href='https://dify.ai/privacy' target='_blank' rel='noopener noreferrer'>Privacy Policy</Link>,<span> </span>
                    <Link href='https://dify.ai/terms' target='_blank' rel='noopener noreferrer'>Terms of Service</Link>
                  </>
              }
            </div>
          </div>
        </div>
        <div className='-mx-8 mb-4 h-[0.5px] bg-divider-regular' />
        <div className='flex items-center justify-between'>
          <div className='text-xs font-medium text-text-primary'>
            {
              isLatest
                ? t('common.about.latestAvailable', { version: langeniusVersionInfo.latest_version })
                : t('common.about.nowAvailable', { version: langeniusVersionInfo.latest_version })
            }
          </div>
          <div className='flex items-center'>
            <Button className='mr-2'>
              <Link
                href={'https://github.com/langgenius/dify/releases'}
                target='_blank' rel='noopener noreferrer'
              >
                {t('common.about.changeLog')}
              </Link>
            </Button>
            {
              !isLatest && !IS_CE_EDITION && (
                <Button variant='primary'>
                  <Link
                    href={langeniusVersionInfo.release_notes}
                    target='_blank' rel='noopener noreferrer'
                  >
                    {t('common.about.updateNow')}
                  </Link>
                </Button>
              )
            }
          </div>
        </div>
      </div>
    </Modal>
  )
}
