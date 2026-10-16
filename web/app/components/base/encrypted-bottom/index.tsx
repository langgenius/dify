import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

type EncryptedBottomProps = Readonly<{
  front?: string
  back?: string
}>

export const EncryptedBottom = ({ front, back }: EncryptedBottomProps) => {
  const { t } = useTranslation(['common'])

  return (
    <p className="flex items-center justify-center rounded-b-2xl border-t-[0.5px] border-divider-subtle bg-background-soft px-2 py-3 system-xs-regular text-text-tertiary">
      <span aria-hidden className="mx-1 i-ri-lock-2-fill size-3 text-text-quaternary" />
      {front ?? t(($) => $['provider.encrypted.front'], { ns: 'common' })}
      <Link
        className="mx-1 text-text-accent"
        target="_blank"
        rel="noopener noreferrer"
        href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html"
      >
        PKCS1_OAEP
      </Link>
      {back ?? t(($) => $['provider.encrypted.back'], { ns: 'common' })}
    </p>
  )
}

type EncryptedFooterProps = Readonly<{
  children: ReactNode
}>

// Keeps the notice pinned under the actions while the dialog body scrolls.
export const EncryptedFooter = ({ children }: EncryptedFooterProps) => (
  <div className="sticky bottom-0 bg-components-panel-bg">{children}</div>
)
