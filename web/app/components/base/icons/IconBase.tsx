import { forwardRef } from 'react'
import { generate } from './utils'
import type { AbstractNode } from './utils'

export type IconData = {
  name: string
  icon: AbstractNode
}

export type IconBaseProps = {
  data: IconData
  className?: string
  onClick?: React.MouseEventHandler<SVGElement>
  style?: React.CSSProperties
}

const IconBase = forwardRef<React.MutableRefObject<HTMLOrSVGElement>, IconBaseProps>((props, ref) => {
  const { data, className, onClick, style, ...restProps } = props

  return generate(data.icon, `svg-${data.name}`, {
    className,
    onClick,
    style,
    'data-icon': data.name,
    'aria-hidden': 'true',
    ...restProps,
    'ref': ref,
  })
})

export default IconBase
