'use client'

import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import useSignInUrl from './use-sign-in-url'

export default function SignIn({ className }: { className?: string }) {
  const { t } = useTranslation(['share'])
  const signInUrl = useSignInUrl()

  return (
    <Link
      href={signInUrl}
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        'h-auto max-w-full gap-0 rounded-full p-0.5',
        className,
      )}
    >
      <Avatar size="sm" aria-hidden="true">
        <AvatarFallback className="rounded-full border-[0.5px] border-divider-regular bg-components-avatar-default-avatar-bg bg-linear-to-br from-components-avatar-bg-mask-stop-0 to-components-avatar-bg-mask-stop-100">
          <span className="i-ri-user-fill size-5 translate-y-1 text-white opacity-90" />
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 px-2 wrap-anywhere whitespace-normal text-text-secondary">
        {t(($) => $['auth.signIn'], { ns: 'share' })}
      </span>
    </Link>
  )
}
