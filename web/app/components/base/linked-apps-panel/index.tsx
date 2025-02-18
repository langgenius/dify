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
    <Link className={cn('group/link-item hover:bg-state-base-hover flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-2', isMobile && 'justify-center')} href={`/app/${detail?.id}/overview`}>
      <div className='flex items-center'>
        <div className={cn('relative h-6 w-6 rounded-md')}>
          <AppIcon size='tiny' iconType={detail.icon_type} icon={detail.icon} background={detail.icon_background} imageUrl={detail.icon_url} />
        </div>
        {!isMobile && <div className={cn(' system-sm-medium text-text-primary ml-2 truncate')}>{detail?.name || '--'}</div>}
      </div>
      <div className='system-2xs-medium-uppercase text-text-tertiary shrink-0 group-hover/link-item:hidden'>{appTypeMap[detail.mode]}</div>
      <RiArrowRightUpLine className='text-text-tertiary hidden h-4 w-4 group-hover/link-item:block' />
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
    <div className='bg-components-panel-bg-blur border-components-panel-border w-[320px] rounded-xl border-[0.5px] p-1 shadow-lg  backdrop-blur-[5px]'>
      <div className='system-xs-medium-uppercase text-text-tertiary mb-0.5 mt-1 pl-2'>{relatedApps.length || '--'} {t('common.datasetMenus.relatedApp')}</div>
      {relatedApps.map((item, index) => (
        <LikedItem key={index} detail={item} isMobile={isMobile} />
      ))}
    </div>
  )
}
export default React.memo(LinkedAppsPanel)
