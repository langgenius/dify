import type { DropdownMenuContent } from '@langgenius/dify-ui/dropdown-menu'
import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

const STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR = 'data-step-by-step-tour-highlight-part'
const STEP_BY_STEP_TOUR_MENU_POPUP_NO_MOTION_CLASS_NAME = 'transition-none data-starting-style:scale-100 data-starting-style:opacity-100 data-ending-style:scale-100 data-ending-style:opacity-100'

type DropdownMenuContentProps = ComponentProps<typeof DropdownMenuContent>
type DropdownMenuPositionerProps = DropdownMenuContentProps['positionerProps']
type DropdownMenuPopupProps = DropdownMenuContentProps['popupProps']

type StepByStepTourDropdownMenuContentProps = {
  highlightPart?: string
  popupClassName?: string
  popupProps?: DropdownMenuPopupProps
  positionerProps?: DropdownMenuPositionerProps
  presentationOnly?: boolean
}

export const getStepByStepTourDropdownMenuContentProps = ({
  highlightPart,
  popupClassName,
  popupProps,
  positionerProps,
  presentationOnly = false,
}: StepByStepTourDropdownMenuContentProps): Pick<DropdownMenuContentProps, 'popupClassName' | 'popupProps' | 'positionerProps'> => {
  const nextPositionerProps = highlightPart
    ? {
        ...positionerProps,
        [STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR]: highlightPart,
        ...(presentationOnly
          ? {
              inert: true,
            }
          : undefined),
      } as DropdownMenuPositionerProps
    : presentationOnly
      ? {
          ...positionerProps,
          inert: true,
        } as DropdownMenuPositionerProps
      : positionerProps

  const nextPopupProps = presentationOnly
    ? {
        ...popupProps,
        'aria-hidden': true,
      } as DropdownMenuPopupProps
    : popupProps

  return {
    popupClassName: cn(
      popupClassName,
      presentationOnly && STEP_BY_STEP_TOUR_MENU_POPUP_NO_MOTION_CLASS_NAME,
      presentationOnly && 'pointer-events-none',
    ),
    popupProps: nextPopupProps,
    positionerProps: nextPositionerProps,
  }
}
