'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
type Props = {}

const CacheReplyConfig: FC<Props> = () => {
  const { t } = useTranslation()

  return (
    <Panel
      className="mt-4"
      headerIcon={
        <MessageFast className='w-4 h-4 text-[#444CE7]'/>
      }
      title={t('appDebug.feature.cacheReply.title')}
    >
      <div className='rounded-lg border border-gray-200 bg-white'>
        xxx
      </div>
    </Panel>
  )
}
export default React.memo(CacheReplyConfig)
