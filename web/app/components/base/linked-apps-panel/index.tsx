'use client'
import type { FC } from 'react'
import type { RelatedApp } from '@/models/datasets'
import { RiArrowRightUpLine } from '@remixicon/react'
import Link from 'next/link'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'

type ILikedItemProps = {
  appStatus?: boolean
  detail: RelatedApp
  isMobile: boolean
}

const appTypeMap = {
  [AppModeEnum.CHAT]: 'Chatbot',
  [AppModeEnum.COMPLETION]: 'Completion',
  [AppModeEnum.AGENT_CHAT]: 'Agent',
  [AppModeEnum.ADVANCED_CHAT]: 'Chatflow',
  [AppModeEnum.WORKFLOW]: 'Workflow',
}

const LikedItem = ({
  detail,
  isMobile,
}: ILikedItemProps) => {
  return (
    <Link className={cn('group/link-item flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-2 hover:bg-state-base-hover', isMobile && 'justify-center')} href={`/app/${detail?.id}/overview`}>
      <div className="flex items-center">
        <div className={cn('relative h-6 w-6 rounded-md')}>
          <AppIcon size="tiny" iconType={detail.icon_type} icon={detail.icon} background={detail.icon_background} imageUrl={detail.icon_url} />
        </div>
        {!isMobile && <div className={cn(' system-sm-medium ml-2 truncate text-text-primary')}>{detail?.name || '--'}</div>}
      </div>
      <div className="system-2xs-medium-uppercase shrink-0 text-text-tertiary group-hover/link-item:hidden">{appTypeMap[detail.mode]}</div>
      <RiArrowRightUpLine className="hidden h-4 w-4 text-text-tertiary group-hover/link-item:block" />
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
  return (
    <div className="w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
      {relatedApps.map((item, index) => (
        <LikedItem key={index} detail={item} isMobile={isMobile} />
      ))}
    </div>
  )
}
export default React.memo(LinkedAppsPanel)
