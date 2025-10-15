'use client'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import dayjs from 'dayjs'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import type { LangGeniusVersionResponse } from '@/models/common'
import { IS_CE_EDITION } from '@/config'
import DifyLogo from '@/app/components/base/logo/dify-logo'

import { useGlobalPublicStore } from '@/context/global-public-context'

type IAccountSettingProps = {
  langGeniusVersionInfo: LangGeniusVersionResponse
  onCancel: () => void
}

export default function AccountAbout({
  langGeniusVersionInfo,
  onCancel,
}: IAccountSettingProps) {
  const { t } = useTranslation()
  const isLatest = langGeniusVersionInfo.current_version === langGeniusVersionInfo.latest_version
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)

  return (
    <Modal
      isShow
      onClose={onCancel}
      className='!w-[480px] !max-w-[480px] !px-6 !py-4'
    >
      <div className='relative'>
        <div className='absolute right-0 top-0 flex h-8 w-8 cursor-pointer items-center justify-center' onClick={onCancel}>
          <RiCloseLine className='h-4 w-4 text-text-tertiary' />
        </div>
        <div className='flex flex-col items-center gap-4 py-8'>
          {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
            ? <img
              src={systemFeatures.branding.workspace_logo}
              className='block h-7 w-auto object-contain'
              alt='logo'
            />
            : <DifyLogo size='large' className='mx-auto' />}

          <div className='text-center text-xs font-normal text-text-tertiary'>Version {langGeniusVersionInfo?.current_version}</div>
          <div className='flex flex-col items-center gap-2 text-center text-xs font-normal text-text-secondary'>
            <div>© {dayjs().year()} LangGenius, Inc., Contributors.</div>
            <div className='text-text-accent'>
              {
                IS_CE_EDITION
                  ? <Link href={'https://github.com/langgenius/dify/blob/main/LICENSE'} target='_blank' rel='noopener noreferrer'>Open Source License</Link>
                  : <>
                    <Link href='https://dify.ai/privacy' target='_blank' rel='noopener noreferrer'>Privacy Policy</Link>,&nbsp;
                    <Link href='https://dify.ai/terms' target='_blank' rel='noopener noreferrer'>Terms of Service</Link>
                  </>
              }
            </div>
          </div>
        </div>
        <div className='-mx-8 mb-4 h-[0.5px] bg-divider-regular' />
        <div className='flex items-center justify-between'>
          <div className='text-xs font-medium text-text-tertiary'>
            {
              isLatest
                ? t('common.about.latestAvailable', { version: langGeniusVersionInfo.latest_version })
                : t('common.about.nowAvailable', { version: langGeniusVersionInfo.latest_version })
            }
          </div>
          <div className='flex items-center'>
            <Button className='mr-2' size='small'>
              <Link
                href={'https://github.com/langgenius/dify/releases'}
                target='_blank' rel='noopener noreferrer'
              >
                {t('common.about.changeLog')}
              </Link>
            </Button>
            {
              !isLatest && !IS_CE_EDITION && (
                <Button variant='primary' size='small'>
                  <Link
                    href={langGeniusVersionInfo.release_notes}
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
