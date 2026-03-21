'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useStore } from '@/app/components/workflow/store'

type Props = {
  isInNode?: boolean
  isExpand: boolean
  className: string
  style: React.CSSProperties
  children: React.ReactNode
}

// It doesn't has workflow store
const WrapInWebApp = ({
  className,
  style,
  children,
}: Props) => {
  return <div className={className} style={style}>{children}</div>
}

const Wrap = ({
  className,
  style,
  isExpand,
  children,
}: Props) => {
  const panelWidth = useStore(state => state.panelWidth)
  const wrapStyle = (() => {
    if (isExpand) {
      return {
        ...style,
        width: panelWidth - 1,
      }
    }
    return style
  })()
  return <div className={className} style={wrapStyle}>{children}</div>
}

const Main: FC<Props> = ({
  isInNode,
  ...otherProps
}: Props) => {
  return isInNode ? <Wrap {...otherProps} /> : <WrapInWebApp {...otherProps} />
}
export default React.memo(Main)
