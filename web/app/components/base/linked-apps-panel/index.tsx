'use client'

import type { RelatedAppResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowRightUpLine } from '@remixicon/react'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'

type ILikedItemProps = Readonly<{
  appStatus?: boolean
  detail: RelatedAppResponse
  isMobile: boolean
}>

const appTypeMap: Partial<Record<RelatedAppResponse['mode'], string>> = {
  chat: 'Chatbot',
  completion: 'Completion',
  'agent-chat': 'Agent',
  'advanced-chat': 'Chatflow',
  workflow: 'Workflow',
}

const LikedItem = ({ detail, isMobile }: ILikedItemProps) => {
  return (
    <Link
      className={cn(
        'group/link-item flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-2 hover:bg-state-base-hover',
        isMobile && 'justify-center',
      )}
      href={`/app/${detail?.id}/overview`}
    >
      <div className="flex items-center">
        <div className={cn('relative size-6 rounded-md')}>
          <AppIcon size="tiny" icon={detail} />
        </div>
        {!isMobile && (
          <div className={cn('ml-2 truncate system-sm-medium text-text-primary')}>
            {detail?.name || '--'}
          </div>
        )}
      </div>
      <div className="shrink-0 system-2xs-medium-uppercase text-text-tertiary group-hover/link-item:hidden">
        {appTypeMap[detail.mode]}
      </div>
      <RiArrowRightUpLine className="hidden size-4 text-text-tertiary group-hover/link-item:block" />
    </Link>
  )
}

type Props = Readonly<{
  relatedApps: RelatedAppResponse[]
  isMobile: boolean
}>

const LinkedAppsPanel: FC<Props> = ({ relatedApps, isMobile }) => {
  return (
    <div className="w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
      {relatedApps.map((item, index) => (
        <LikedItem key={index} detail={item} isMobile={isMobile} />
      ))}
    </div>
  )
}
export default React.memo(LinkedAppsPanel)
