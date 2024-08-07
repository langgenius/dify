'use client'

import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { Beaker02 } from '@/app/components/base/icons/src/vender/solid/education'
import { TerminalSquare } from '@/app/components/base/icons/src/vender/solid/development'

const headerEnvClassName: { [k: string]: string } = {
  DEVELOPMENT: 'bg-[#FEC84B] border-[#FDB022] text-[#93370D]',
  TESTING: 'bg-[#A5F0FC] border-[#67E3F9] text-[#164C63]',
}

const EnvNav = () => {
  const { t } = useTranslation()
  const { langeniusVersionInfo } = useAppContext()
  const showEnvTag = langeniusVersionInfo.current_env === 'TESTING' || langeniusVersionInfo.current_env === 'DEVELOPMENT'

  if (!showEnvTag)
    return null

  return (
    <div className={`
      flex items-center h-[22px] mr-4 rounded-md px-2 text-xs font-medium border
      ${headerEnvClassName[langeniusVersionInfo.current_env]}
    `}>
      {
        langeniusVersionInfo.current_env === 'TESTING' && (
          <>
            <Beaker02 className='w-3 h-3 mr-1' />
            {t('common.environment.testing')}
          </>
        )
      }
      {
        langeniusVersionInfo.current_env === 'DEVELOPMENT' && (
          <>
            <TerminalSquare className='w-3 h-3 mr-1' />
            {t('common.environment.development')}
          </>
        )
      }
    </div>
  )
}

export default EnvNav
