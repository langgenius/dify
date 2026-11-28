'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'

const ENVIRONMENTS = {
  DEVELOPMENT: {
    label: 'environment.development',
    iconClassName: 'i-custom-vender-solid-development-terminal-square',
    className: 'border-[#FDB022] bg-[#FEC84B] text-[#93370D]',
  },
  TESTING: {
    label: 'environment.testing',
    iconClassName: 'i-custom-vender-solid-education-beaker-02',
    className: 'border-[#67E3F9] bg-[#A5F0FC] text-[#164C63]',
  },
} as const

function isLabeledEnvironment(env: string | null): env is keyof typeof ENVIRONMENTS {
  return env !== null && Object.hasOwn(ENVIRONMENTS, env)
}

export function EnvironmentBadge() {
  const { t } = useTranslation(['common'])
  const { data: currentEnv } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.meta.currentEnv,
  })

  if (!isLabeledEnvironment(currentEnv)) return null

  const environment = ENVIRONMENTS[currentEnv]

  return (
    <div className="mt-auto shrink-0 px-2 pb-2">
      <span
        className={cn(
          'flex h-5.5 items-center gap-1 rounded-md border px-2 text-xs font-medium',
          environment.className,
        )}
      >
        <span aria-hidden className={cn('size-3 shrink-0', environment.iconClassName)} />
        {t(($) => $[environment.label], { ns: 'common' })}
      </span>
    </div>
  )
}
