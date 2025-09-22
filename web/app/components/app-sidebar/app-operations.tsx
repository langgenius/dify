import type { JSX } from 'react'
import { cloneElement, useCallback } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../base/portal-to-follow-elem'
import Divider from '@/app/components/base/divider'
import { RiMoreFill } from '@remixicon/react'
import cn from '@/utils/classnames'

export type Operation = {
  id: string
  title: string
  icon: JSX.Element
  onClick: () => void
  type?: 'action' | 'divider'
  className?: string
}

const AppOperations = ({ primaryOperations, secondaryOperations, gap }: {
  primaryOperations: Operation[]
  secondaryOperations: Operation[]
  gap: number
}) => {
  const { t } = useTranslation()
  const [showMore, setShowMore] = useState(false)
  const handleTriggerMore = useCallback(() => {
    setShowMore(prev => !prev)
  }, [])

  const renderSecondaryOperation = (operation: Operation, index: number) => {
    if (operation.type === 'divider') {
      return (
        <Divider key={operation.id || `divider-${index}`} className='my-1' />
      )
    }

    return (
      <div
        key={operation.id}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-x-1 rounded-lg p-1.5 hover:bg-state-base-hover',
          operation.className,
        )}
        onClick={operation.onClick}
      >
        {cloneElement(operation.icon, {
          className: 'h-4 w-4 text-text-tertiary',
        })}
        <span className='system-md-regular text-text-secondary'>
          {operation.title}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center self-stretch overflow-hidden" style={{ gap }}>
      {/* Fixed primary operations */}
      {primaryOperations.map(operation =>
        <Button
          key={operation.id}
          size={'small'}
          variant={'secondary'}
          className="gap-[1px] px-1.5"
          onClick={operation.onClick}>
          {cloneElement(operation.icon, { className: 'h-3.5 w-3.5 text-components-button-secondary-text' })}
          <span className="system-xs-medium text-components-button-secondary-text">
            {operation.title}
          </span>
        </Button>,
      )}

      {/* More button - always show if there are secondary operations */}
      {secondaryOperations.length > 0 && (
        <PortalToFollowElem
          open={showMore}
          onOpenChange={setShowMore}
          placement='bottom-end'
          offset={{
            mainAxis: 4,
            crossAxis: 55,
          }}>
          <PortalToFollowElemTrigger onClick={handleTriggerMore}>
            <Button
              size={'small'}
              variant={'secondary'}
              className='gap-1 px-1.5'
            >
              <RiMoreFill className='h-3.5 w-3.5 text-components-button-secondary-text' />
              <span className='system-xs-medium text-components-button-secondary-text'>{t('common.operation.more')}</span>
            </Button>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className='z-[21]'>
            <div className='flex min-w-[264px] flex-col rounded-[12px] border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[10px]'>
              {secondaryOperations.map((operation, index) => renderSecondaryOperation(operation, index))}
            </div>
          </PortalToFollowElemContent>
        </PortalToFollowElem>
      )}
    </div>
  )
}

export default AppOperations
