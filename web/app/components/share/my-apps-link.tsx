'use client'

import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { basePath } from '@/utils/var'
import { useWebAppEntry } from './webapp-entry'

export default function MyAppsLink({ className }: { className?: string }) {
  const { t } = useTranslation(['app'])
  const entry = useWebAppEntry()
  if (!entry || !('account' in entry) || entry.account !== 'authenticated') return null

  return (
    <a
      href={`${basePath.replace(/\/+$/, '')}/my-apps`}
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        'h-8 justify-start gap-0.5 px-3 py-2',
        className,
      )}
    >
      <span aria-hidden="true" className="i-ri-arrow-left-s-line size-4 shrink-0 rtl:rotate-180" />
      <span className="px-0.5">{t(($) => $['endUser.myApps'], { ns: 'app' })}</span>
    </a>
  )
}
