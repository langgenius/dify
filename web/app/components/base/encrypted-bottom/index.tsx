import type { I18nKeysWithPrefix } from '@/types/i18n'
import { RiLock2Fill } from '@remixicon/react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type EncryptedKey = I18nKeysWithPrefix<'common', 'provider.encrypted.'>

type Props = {
  className?: string
  frontTextKey?: EncryptedKey
  backTextKey?: EncryptedKey
}

const DEFAULT_FRONT_KEY: EncryptedKey = 'provider.encrypted.front'
const DEFAULT_BACK_KEY: EncryptedKey = 'provider.encrypted.back'

export const EncryptedBottom = (props: Props) => {
  const { t } = useTranslation()
  const { frontTextKey = DEFAULT_FRONT_KEY, backTextKey = DEFAULT_BACK_KEY, className } = props

  return (
    <div className={cn('system-xs-regular flex items-center justify-center rounded-b-2xl border-t-[0.5px] border-divider-subtle bg-background-soft px-2 py-3 text-text-tertiary', className)}>
      <RiLock2Fill className="mx-1 h-3 w-3 text-text-quaternary" />
      {t(frontTextKey, { ns: 'common' })}
      <Link
        className="mx-1 text-text-accent"
        target="_blank"
        rel="noopener noreferrer"
        href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html"
      >
        PKCS1_OAEP
      </Link>
      {t(backTextKey, { ns: 'common' })}
    </div>
  )
}
