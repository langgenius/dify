'use client'

import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import {
  RiChatUploadFill,
  RiChatUploadLine,
} from '@remixicon/react'
import classNames from '@/utils/classnames'
type FilesNavProps = {
  className?: string
}

const FilesNav = ({
  className,
}: FilesNavProps) => {
  const { t } = useTranslation()
  const selectedSegment = useSelectedLayoutSegment()
  const actived = selectedSegment === 'upload'

  return (
    <Link href="/upload" className={classNames(
      className, 'group',
      actived && 'bg-white shadow-md',
      actived ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200',
    )}>
      {
        actived
          ? <RiChatUploadFill className='mr-2 w-4 h-4' />
          : <RiChatUploadLine className='mr-2 w-4 h-4' />
      }
      {t('common.menus.files')}
    </Link>
  )
}

export default FilesNav
