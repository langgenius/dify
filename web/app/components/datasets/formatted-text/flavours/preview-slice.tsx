import { useState } from 'react'
import type { FC, ReactNode } from 'react'
import { autoUpdate, flip, inline, shift, useDismiss, useFloating, useHover, useInteractions, useRole } from '@floating-ui/react'
import type { SliceProps } from './type'
import { SliceContainer, SliceContent, SliceDivider, SliceLabel } from './shared'

type PreviewSliceProps = SliceProps<{
  label: ReactNode
  tooltip: ReactNode
  labelInnerClassName?: string
  dividerClassName?: string
}>

export const PreviewSlice: FC<PreviewSliceProps> = (props) => {
  const { label, className, text, tooltip, labelInnerClassName, dividerClassName, ...rest } = props
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
      <SliceContainer {...rest}
        className={className}
        ref={refs.setReference}
        {...getReferenceProps()}
      >
        <SliceLabel labelInnerClassName={labelInnerClassName}>{label}</SliceLabel>
        <SliceContent>{text}</SliceContent>
        <SliceDivider className={dividerClassName} />
      </SliceContainer>
      {tooltipOpen && <span
        ref={refs.setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        className='rounded-md border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-2 text-xs leading-4 text-text-secondary shadow shadow-shadow-shadow-5 backdrop-blur-[5px]'
      >
        {tooltip}
      </span>}
    </>
  )
}
