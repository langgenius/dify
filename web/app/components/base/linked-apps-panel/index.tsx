'use client'
import type { FC } from 'react'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import AppIcon from '@/app/components/base/app-icon'
import type { RelatedApp } from '@/models/datasets'

type ILikedItemProps = {
  appStatus?: boolean
  detail: RelatedApp
  isMobile: boolean
}

const appTypeMap = {
  'chat': 'Chatbot',
  'completion': 'Completion',
  'agent-chat': 'Agent',
  'advanced-chat': 'Chatflow',
  'workflow': 'Workflow',
}

const LikedItem = ({
  detail,
  isMobile,
}: ILikedItemProps) => {
  return (
    <Link className={cn('group/link-item flex items-center justify-between w-full h-8 rounded-lg hover:bg-state-base-hover cursor-pointer px-2', isMobile && 'justify-center')} href={`/app/${detail?.id}/overview`}>
      <div className='flex items-center'>
        <div className={cn('relative w-6 h-6 rounded-md')}>
          <AppIcon size='tiny' iconType={detail.icon_type} icon={detail.icon} background={detail.icon_background} imageUrl={detail.icon_url} />
        </div>
        {!isMobile && <div className={cn(' ml-2 truncate system-sm-medium text-text-primary')}>{detail?.name || '--'}</div>}
      </div>
      <div className='group-hover/link-item:hidden shrink-0 system-2xs-medium-uppercase text-text-tertiary'>{appTypeMap[detail.mode]}</div>
      <RiArrowRightUpLine className='hidden group-hover/link-item:block w-4 h-4 text-text-tertiary' />
    </Link>
  )
}

type Props = {
  relatedApps: RelatedApp[]
  isMobile: boolean
}

const LinkedAppsPanel: FC<Props> = ({
  relatedApps,
  isMobile,
}) => {
  const { t } = useTranslation()
  return (
    <div className='p-1 w-[320px] bg-components-panel-bg-blur border-[0.5px] border-components-panel-border shadow-lg rounded-xl  backdrop-blur-[5px]'>
      <div className='mt-1 mb-0.5 pl-2 system-xs-medium-uppercase text-text-tertiary'>{relatedApps.length || '--'} {t('common.datasetMenus.relatedApp')}</div>
      {relatedApps.map((item, index) => (
        <LikedItem key={index} detail={item} isMobile={isMobile} />
      ))}
    </div>
  )
}
export default React.memo(LinkedAppsPanel)
