import { useState } from 'react'
import type { FC, ReactNode } from 'react'
import { FloatingFocusManager, type OffsetOptions, autoUpdate, flip, offset, shift, useDismiss, useFloating, useHover, useInteractions, useRole } from '@floating-ui/react'
import { RiDeleteBinLine } from '@remixicon/react'
// @ts-expect-error no types available
import lineClamp from 'line-clamp'
import type { SliceProps } from './type'
import { SliceContainer, SliceContent, SliceDivider, SliceLabel } from './shared'
import classNames from '@/utils/classnames'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'

type EditSliceProps = SliceProps<{
  label: ReactNode
  onDelete: () => void
  labelClassName?: string
  labelInnerClassName?: string
  contentClassName?: string
  showDivider?: boolean
  offsetOptions?: OffsetOptions
}>

export const EditSlice: FC<EditSliceProps> = (props) => {
  const {
    label,
    className,
    text,
    onDelete,
    labelClassName,
    labelInnerClassName,
    contentClassName,
    showDivider = true,
    offsetOptions,
    ...rest
  } = props
  const [delBtnShow, setDelBtnShow] = useState(false)
  const [isDelBtnHover, setDelBtnHover] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: delBtnShow,
    onOpenChange: setDelBtnShow,
    placement: 'right-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      flip(),
      shift(),
      offset(offsetOptions),
    ],
  })
  const hover = useHover(context, {})
  const dismiss = useDismiss(context)
  const role = useRole(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role])

  const isDestructive = delBtnShow && isDelBtnHover

  return (
    <>
      <SliceContainer {...rest}
        className={classNames('block mr-0', className)}
        ref={(ref) => {
          refs.setReference(ref)
          if (ref)
            lineClamp(ref, 4)
        }}
        {...getReferenceProps()}
      >
        <SliceLabel
          className={classNames(
            isDestructive && '!bg-state-destructive-solid !text-text-primary-on-surface',
            labelClassName,
          )}
          labelInnerClassName={labelInnerClassName}
        >
          {label}
        </SliceLabel>
        <SliceContent
          className={classNames(
            isDestructive && '!bg-state-destructive-hover-alt',
            contentClassName,
          )}
        >
          {text}
        </SliceContent>
        {showDivider && <SliceDivider
          className={classNames(
            isDestructive && '!bg-state-destructive-hover-alt',
          )}
        />}
        {delBtnShow && <FloatingFocusManager
          context={context}
        >
          <span
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className='bg-components-actionbar-bg inline-flex items-center justify-center rounded-lg p-1 shadow'
            onMouseEnter={() => setDelBtnHover(true)}
            onMouseLeave={() => setDelBtnHover(false)}
          >
            <ActionButton
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
                setDelBtnShow(false)
              }}
              state={ActionButtonState.Destructive}
            >
              <RiDeleteBinLine className='h-4 w-4' />
            </ActionButton>
          </span>
        </FloatingFocusManager>}
      </SliceContainer>
    </>
  )
}
