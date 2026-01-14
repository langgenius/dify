import type { JSX } from 'react'
import { RiMoreLine } from '@remixicon/react'
import { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../base/portal-to-follow-elem'

export type Operation = {
  id: string
  title: string
  icon: JSX.Element
  onClick: () => void
  type?: 'divider'
}

type AppOperationsProps = {
  gap: number
  operations?: Operation[]
  primaryOperations?: Operation[]
  secondaryOperations?: Operation[]
}

const EMPTY_OPERATIONS: Operation[] = []

const AppOperations = ({
  operations,
  primaryOperations,
  secondaryOperations,
  gap,
}: AppOperationsProps) => {
  const { t } = useTranslation()
  const [visibleOpreations, setVisibleOperations] = useState<Operation[]>([])
  const [moreOperations, setMoreOperations] = useState<Operation[]>([])
  const [showMore, setShowMore] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const handleTriggerMore = useCallback(() => {
    setShowMore(true)
  }, [setShowMore])

  const primaryOps = useMemo(() => {
    if (operations)
      return operations
    if (primaryOperations)
      return primaryOperations
    return EMPTY_OPERATIONS
  }, [operations, primaryOperations])

  const secondaryOps = useMemo(() => {
    if (operations)
      return EMPTY_OPERATIONS
    if (secondaryOperations)
      return secondaryOperations
    return EMPTY_OPERATIONS
  }, [operations, secondaryOperations])
  const inlineOperations = primaryOps.filter(operation => operation.type !== 'divider')

  useEffect(() => {
    const applyState = (visible: Operation[], overflow: Operation[]) => {
      const combinedMore = [...overflow, ...secondaryOps]
      if (!overflow.length && combinedMore[0]?.type === 'divider')
        combinedMore.shift()
      setVisibleOperations(visible)
      setMoreOperations(combinedMore)
    }

    const inline = primaryOps.filter(operation => operation.type !== 'divider')

    if (!inline.length) {
      applyState([], [])
      return
    }

    const navElement = navRef.current
    const moreElement = document.getElementById('more-measure')

    if (!navElement || !moreElement)
      return

    let width = 0
    const containerWidth = navElement.clientWidth
    const moreWidth = moreElement.clientWidth

    if (containerWidth === 0 || moreWidth === 0)
      return

    const updatedEntries: Record<string, boolean> = inline.reduce((pre, cur) => {
      pre[cur.id] = false
      return pre
    }, {} as Record<string, boolean>)
    const childrens = Array.from(navElement.children).slice(0, -1)
    for (let i = 0; i < childrens.length; i++) {
      const child = childrens[i] as HTMLElement
      const id = child.dataset.targetid
      if (!id)
        break
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

    const visible = inline.filter(item => updatedEntries[item.id])
    const overflow = inline.filter(item => !updatedEntries[item.id])

    applyState(visible, overflow)
  }, [gap, primaryOps, secondaryOps])

  const shouldShowMoreButton = moreOperations.length > 0

  return (
    <>
      <div
        aria-hidden="true"
        ref={navRef}
        className="pointer-events-none flex h-0 items-center self-stretch overflow-hidden"
        style={{ gap }}
      >
        {inlineOperations.map(operation => (
          <Button
            key={operation.id}
            data-targetid={operation.id}
            size="small"
            variant="secondary"
            className="gap-[1px]"
            tabIndex={-1}
          >
            {cloneElement(operation.icon, { className: 'h-3.5 w-3.5 text-components-button-secondary-text' })}
            <span className="system-xs-medium text-components-button-secondary-text">
              {operation.title}
            </span>
          </Button>
        ))}
        <Button
          id="more-measure"
          size="small"
          variant="secondary"
          className="gap-[1px]"
          tabIndex={-1}
        >
          <RiMoreLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
          <span className="system-xs-medium text-components-button-secondary-text">
            {t('operation.more', { ns: 'common' })}
          </span>
        </Button>
      </div>
      <div className="flex items-center self-stretch overflow-hidden" style={{ gap }}>
        {visibleOpreations.map(operation => (
          <Button
            key={operation.id}
            data-targetid={operation.id}
            size="small"
            variant="secondary"
            className="gap-[1px]"
            onClick={operation.onClick}
          >
            {cloneElement(operation.icon, { className: 'h-3.5 w-3.5 text-components-button-secondary-text' })}
            <span className="system-xs-medium text-components-button-secondary-text">
              {operation.title}
            </span>
          </Button>
        ))}
        {shouldShowMoreButton && (
          <PortalToFollowElem
            open={showMore}
            onOpenChange={setShowMore}
            placement="bottom-end"
            offset={{ mainAxis: 4 }}
          >
            <PortalToFollowElemTrigger onClick={handleTriggerMore}>
              <Button
                size="small"
                variant="secondary"
                className="gap-[1px]"
              >
                <RiMoreLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
                <span className="system-xs-medium text-components-button-secondary-text">
                  {t('operation.more', { ns: 'common' })}
                </span>
              </Button>
            </PortalToFollowElemTrigger>
            <PortalToFollowElemContent className="z-[30]">
              <div className="flex min-w-[264px] flex-col rounded-[12px] border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
                {moreOperations.map(item => item.type === 'divider'
                  ? (
                      <div key={item.id} className="my-1 h-px bg-divider-subtle" />
                    )
                  : (
                      <div
                        key={item.id}
                        className="flex h-8 cursor-pointer items-center gap-x-1 rounded-lg p-1.5 hover:bg-state-base-hover"
                        onClick={item.onClick}
                      >
                        {cloneElement(item.icon, { className: 'h-4 w-4 text-text-tertiary' })}
                        <span className="system-md-regular text-text-secondary">{item.title}</span>
                      </div>
                    ))}
              </div>
            </PortalToFollowElemContent>
          </PortalToFollowElem>
        )}
      </div>
    </>
  )
}

export default AppOperations
