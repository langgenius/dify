'use client'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { PortalToFollowElemOptions } from '@/app/components/base/portal-to-follow-elem'

type IFloatRightContainerProps = {
  isMobile: boolean
  open: boolean
  toggle: () => void
  triggerElement?: React.ReactNode
  children?: React.ReactNode
} & PortalToFollowElemOptions

const FloatRightContainer = ({ open, toggle, triggerElement, isMobile, children, ...portalProps }: IFloatRightContainerProps) => {
  return (
    <>
      {isMobile && (
        <PortalToFollowElem open={open} {...portalProps}>
          <PortalToFollowElemTrigger onClick={toggle}>
            {triggerElement}
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent>
            {children}
          </PortalToFollowElemContent>
        </PortalToFollowElem>
      )}
      {!isMobile && open && (
        <>{children}</>
      )}
    </>
  )
}

export default FloatRightContainer
