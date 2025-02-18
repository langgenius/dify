'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Drawer from '@/app/components/base/drawer'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

type Props = {
  isShow: boolean
  onHide: () => void
  panelClassName?: string
  maxWidthClassName?: string
  contentClassName?: string
  headerClassName?: string
  height?: number | string
  title: string | React.JSX.Element
  titleDescription?: string | React.JSX.Element
  body: React.JSX.Element
  foot?: React.JSX.Element
  isShowMask?: boolean
  clickOutsideNotOpen?: boolean
  positionCenter?: boolean
}

const DrawerPlus: FC<Props> = ({
  isShow,
  onHide,
  panelClassName = '',
  maxWidthClassName = '!max-w-[640px]',
  height = 'calc(100vh - 72px)',
  contentClassName,
  headerClassName,
  title,
  titleDescription,
  body,
  foot,
  isShowMask,
  clickOutsideNotOpen = true,
  positionCenter,
}) => {
  const ref = useRef(null)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  if (!isShow)
    return null

  return (
    // clickOutsideNotOpen to fix confirm modal click cause drawer close
    <Drawer
      isOpen={isShow}
      clickOutsideNotOpen={clickOutsideNotOpen}
      onClose={onHide}
      footer={null}
      mask={isMobile || isShowMask}
      positionCenter={positionCenter}
      panelClassname={cn('mx-2 mb-3 mt-16 rounded-xl !p-0 sm:mr-2', panelClassName, maxWidthClassName)}
    >
      <div
        className={cn(contentClassName, 'bg-components-panel-bg border-divider-subtle flex w-full flex-col rounded-xl border-[0.5px] shadow-xl')}
        style={{
          height,
        }}
        ref={ref}
      >
        <div className={cn(headerClassName, 'border-divider-subtle shrink-0 border-b py-4')}>
          <div className='flex h-6 items-center justify-between pl-6 pr-5'>
            <div className='system-xl-semibold text-text-primary'>
              {title}
            </div>
            <div className='flex items-center'>
              <div
                onClick={onHide}
                className='flex h-6 w-6 cursor-pointer items-center justify-center'
              >
                <RiCloseLine className='text-text-tertiary h-4 w-4' />
              </div>
            </div>
          </div>
          {titleDescription && (
            <div className='system-xs-regular text-text-tertiary pl-6 pr-10'>
              {titleDescription}
            </div>
          )}
        </div>
        <div className='grow overflow-y-auto'>
          {body}
        </div>
        {foot && (
          <div className='shrink-0'>
            {foot}
          </div>
        )}
      </div>
    </Drawer>
  )
}
export default React.memo(DrawerPlus)
