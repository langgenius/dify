import type { JSX } from 'react'
import { cloneElement, useCallback } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../base/portal-to-follow-elem'
import { RiMoreLine } from '@remixicon/react'

export type Operation = {
  id: string; title: string; icon: JSX.Element; onClick: () => void
}

const AppOperations = ({ operations, gap }: {
  operations: Operation[]
  gap: number
}) => {
  const { t } = useTranslation()
  const [visibleOpreations, setVisibleOperations] = useState<Operation[]>([])
  const [moreOperations, setMoreOperations] = useState<Operation[]>([])
  const [showMore, setShowMore] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const handleTriggerMore = useCallback(() => {
    setShowMore(true)
  }, [setShowMore])

  useEffect(() => {
    const moreElement = document.getElementById('more')
    const navElement = document.getElementById('nav')
    let width = 0
    const containerWidth = navElement?.clientWidth ?? 0
    const moreWidth = moreElement?.clientWidth ?? 0

    if (containerWidth === 0 || moreWidth === 0) return

    const updatedEntries: Record<string, boolean> = operations.reduce((pre, cur) => {
      pre[cur.id] = false
      return pre
    }, {} as Record<string, boolean>)
    const childrens = Array.from(navRef.current!.children).slice(0, -1)
    for (let i = 0; i < childrens.length; i++) {
      const child: any = childrens[i]
      const id = child.dataset.targetid
      if (!id) break
      const childWidth = child.clientWidth

      if (width + gap + childWidth + moreWidth <= containerWidth) {
        updatedEntries[id] = true
        width += gap + childWidth
      }
      else {
        if (i === childrens.length - 1 && width + childWidth <= containerWidth)
          updatedEntries[id] = true
        else
          updatedEntries[id] = false
        break
      }
    }
    setVisibleOperations(operations.filter(item => updatedEntries[item.id]))
    setMoreOperations(operations.filter(item => !updatedEntries[item.id]))
  }, [operations, gap])

  return (
    <>
      {!visibleOpreations.length && <div
        id="nav"
        ref={navRef}
        className="flex h-0 items-center self-stretch overflow-hidden"
        style={{ gap }}
      >
        {operations.map((operation, index) =>
          <Button
            key={index}
            data-targetid={operation.id}
            size={'small'}
            variant={'secondary'}
            className="gap-[1px]">
            {cloneElement(operation.icon, { className: 'h-3.5 w-3.5 text-components-button-secondary-text' })}
            <span className="system-xs-medium text-components-button-secondary-text">
              {operation.title}
            </span>
          </Button>,
        )}
        <Button
          id="more"
          size={'small'}
          variant={'secondary'}
          className="gap-[1px]"
        >
          <RiMoreLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
          <span className="system-xs-medium text-components-button-secondary-text">
            {t('common.operation.more')}
          </span>
        </Button>
      </div>}
      <div className="flex items-center self-stretch overflow-hidden" style={{ gap }}>
        {visibleOpreations.map(operation =>
          <Button
            key={operation.id}
            data-targetid={operation.id}
            size={'small'}
            variant={'secondary'}
            className="gap-[1px]"
            onClick={operation.onClick}>
            {cloneElement(operation.icon, { className: 'h-3.5 w-3.5 text-components-button-secondary-text' })}
            <span className="system-xs-medium text-components-button-secondary-text">
              {operation.title}
            </span>
          </Button>,
        )}
        {visibleOpreations.length < operations.length && <PortalToFollowElem
          open={showMore}
          onOpenChange={setShowMore}
          placement='bottom-end'
          offset={{
            mainAxis: 4,
          }}>
          <PortalToFollowElemTrigger onClick={handleTriggerMore}>
            <Button
              size={'small'}
              variant={'secondary'}
              className='gap-[1px]'
            >
              <RiMoreLine className='h-3.5 w-3.5 text-components-button-secondary-text' />
              <span className='system-xs-medium text-components-button-secondary-text'>{t('common.operation.more')}</span>
            </Button>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className='z-[21]'>
            <div className='flex min-w-[264px] flex-col rounded-[12px] border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]'>
              {moreOperations.map(item => <div
                key={item.id}
                className='flex h-8 cursor-pointer items-center gap-x-1 rounded-lg p-1.5 hover:bg-state-base-hover'
                onClick={item.onClick}
              >
                {cloneElement(item.icon, { className: 'h-4 w-4 text-text-tertiary' })}
                <span className='system-md-regular text-text-secondary'>{item.title}</span>
              </div>)}
            </div>
          </PortalToFollowElemContent>
        </PortalToFollowElem>}
      </div>
    </>
  )
}

export default AppOperations
