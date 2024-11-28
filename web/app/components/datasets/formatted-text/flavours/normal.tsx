import { useState } from 'react'
import type { FC, ReactNode } from 'react'
import { autoUpdate, flip, inline, shift, useDismiss, useFloating, useHover, useInteractions, useRole } from '@floating-ui/react'
import type { SliceProps } from './type'
import classNames from '@/utils/classnames'

type NormalSliceProps = SliceProps<{
  label: ReactNode
  tooltip: ReactNode
}>

const baseStyle = 'py-[3px]'

export const NormalSlice: FC<NormalSliceProps> = (props) => {
  const { label, className, text, tooltip, ...rest } = props
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open: tooltipOpen,
    onOpenChange: setTooltipOpen,
    whileElementsMounted: autoUpdate,
    placement: 'top',
    middleware: [
      inline(),
      flip(),
      shift(),
    ],
  })
  const hover = useHover(context, {
    delay: { open: 500 },
    move: true,
  })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role])
  return (
    <>
      <span {...rest} className={classNames(
        'group align-bottom mr-1 select-none text-sm',
        className,
      )} ref={refs.setReference}
      {...getReferenceProps()}
      >
        <span className={classNames(
          baseStyle,
          'px-1 bg-state-base-hover-alt text-text-tertiary group-hover:bg-state-accent-solid group-hover:text-white',
        )}>
          {label}
        </span>
        <span className={classNames(
          baseStyle,
          'px-1 text-text-secondary bg-state-base-hover group-hover:bg-state-accent-hover-alt group-hover:text-text-primary',
        )}>
          {text}
        </span>
        <span
          className='py-[3px] bg-state-base-active group-hover:bg-state-accent-solid text-sm px-[1px]'
        >
          {/* use a zero-width space to make the hover area bigger */}
          &#8203;
        </span>
      </span>
      {tooltipOpen && <div ref={refs.setFloating} style={floatingStyles}
        {...getFloatingProps()}
        className='p-2 rounded-md bg-components-tooltip-bg shadow shadow-shadow-shadow-5 backdrop-blur-[5px] text-text-secondary leading-4 border-[0.5px] border-components-panel-border text-xs'
      >
        {tooltip}
      </div>}
    </>
  )
}
