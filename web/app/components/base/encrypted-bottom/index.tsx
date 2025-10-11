import cn from '@/utils/classnames'
import { RiLock2Fill } from '@remixicon/react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

type Props = {
  className?: string
  frontTextKey?: string
  backTextKey?: string
}

export const EncryptedBottom = (props: Props) => {
  const { t } = useTranslation()
  const { frontTextKey, backTextKey, className } = props

  return (
    <div className={cn('system-xs-regular flex items-center border-t-[0.5px] border-divider-subtle bg-background-soft px-2 py-3 text-text-tertiary', className)}>
      <RiLock2Fill className='mx-1 h-3 w-3 text-text-quaternary' />
      {t(frontTextKey || 'common.provider.encrypted.front')}
      <Link
        className='mx-1 text-text-accent'
        target='_blank' rel='noopener noreferrer'
        href='https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html'
      >
        PKCS1_OAEP
      </Link>
      {t(backTextKey || 'common.provider.encrypted.back')}
    </div>
  )
}
