'use client'
import type { IDrawerProps } from '@/app/components/base/drawer'
import Drawer from '@/app/components/base/drawer'

type IFloatRightContainerProps = {
  isMobile: boolean
  children?: React.ReactNode
} & IDrawerProps

const FloatRightContainer = ({ isMobile, children, isOpen, ...drawerProps }: IFloatRightContainerProps) => {
  return (
    <>
      {isMobile && (
        <Drawer isOpen={isOpen} {...drawerProps}>{children}</Drawer>
      )}
      {(!isMobile && isOpen) && (
        <>{children}</>
      )}
    </>
  )
}

export default FloatRightContainer
