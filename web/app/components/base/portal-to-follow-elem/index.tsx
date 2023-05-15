'use client'
import { useBoolean } from 'ahooks'
import React, { FC, useEffect, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'

export interface IPortalToFollowElementProps {
  portalElem: React.ReactNode
  children: React.ReactNode
  controlShow?: number
  controlHide?: number
}

const PortalToFollowElement: FC<IPortalToFollowElementProps> = ({
  portalElem,
  children,
  controlShow,
  controlHide
}) => {
  const [isShowContent, { setTrue: showContent, setFalse: hideContent, toggle: toggleContent }] = useBoolean(false)
  const [wrapElem, setWrapElem] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (controlShow) {
      showContent()
    }
  }, [controlShow])

  useEffect(() => {
    if (controlHide) {
      hideContent()
    }
  }, [controlHide])

  // todo use click outside hidden
  const triggerElemRef = useRef<HTMLElement>(null)

  const calLoc = () => {
    const triggerElem = triggerElemRef.current
    if (!triggerElem) {
      return {
        display: 'none'
      }
    }
    const {
      left: triggerLeft,
      top: triggerTop,
      height
    } = triggerElem.getBoundingClientRect();

    return {
      position: 'fixed',
      left: triggerLeft,
      top: triggerTop + height,
      zIndex: 999
    }
  }

  useEffect(() => {
    if (isShowContent) {
      const holder = document.createElement('div')
      const root = createRoot(holder)
      const style = calLoc()
      root.render(
        <div style={style as React.CSSProperties}>
          {portalElem}
        </div>
      )
      document.body.appendChild(holder)
      setWrapElem(holder)
      console.log(holder)
    } else {
      wrapElem?.remove?.()
      setWrapElem(null)
    }
  }, [isShowContent])

  return (
    <div ref={triggerElemRef as any} onClick={toggleContent}>
      {children}
    </div>
  )
}

export default React.memo(PortalToFollowElement)
