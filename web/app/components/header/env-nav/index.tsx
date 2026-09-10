'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'

const headerEnvClassName: { [k: string]: string } = {
  DEVELOPMENT: 'bg-[#FEC84B] border-[#FDB022] text-[#93370D]',
  TESTING: 'bg-[#A5F0FC] border-[#67E3F9] text-[#164C63]',
}

const EnvNav = () => {
  const { t } = useTranslation()
  const { data: currentEnv } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.meta.currentEnv,
  })
  const showEnvTag = currentEnv === 'TESTING' || currentEnv === 'DEVELOPMENT'

  if (!showEnvTag) return null

  return (
    <div
      className={`mr-1 flex h-5.5 items-center rounded-md border px-2 text-xs font-medium ${headerEnvClassName[currentEnv]} `}
    >
      {currentEnv === 'TESTING' && (
        <>
          <span aria-hidden className="i-custom-vender-solid-education-beaker-02 size-3" />
          <div className="ml-1">{t(($) => $['environment.testing'], { ns: 'common' })}</div>
        </>
      )}
      {currentEnv === 'DEVELOPMENT' && (
        <>
          <span aria-hidden className="i-custom-vender-solid-development-terminal-square size-3" />
          <div className="ml-1">{t(($) => $['environment.development'], { ns: 'common' })}</div>
        </>
      )}
    </div>
  )
}

export default EnvNav
