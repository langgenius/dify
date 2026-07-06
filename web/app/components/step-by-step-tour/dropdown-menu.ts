import type { DropdownMenuContent } from '@langgenius/dify-ui/dropdown-menu'
import type { ComponentProps, SyntheticEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useState } from 'react'

const STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR = 'data-step-by-step-tour-highlight-part'
const STEP_BY_STEP_TOUR_MENU_POPUP_NO_MOTION_CLASS_NAME = 'transition-none data-starting-style:scale-100 data-starting-style:opacity-100 data-ending-style:scale-100 data-ending-style:opacity-100'
const STEP_BY_STEP_TOUR_MENU_PRESENTATION_CLASS_NAME = 'pointer-events-none cursor-default'

type DropdownMenuContentProps = ComponentProps<typeof DropdownMenuContent>
type DropdownMenuPositionerProps = DropdownMenuContentProps['positionerProps']
type DropdownMenuPopupProps = DropdownMenuContentProps['popupProps']

type StepByStepTourDropdownMenuContentProps = {
  highlightPart?: string
  disableMotion?: boolean
  interactionMode?: 'interactive' | 'presentation'
  popupClassName?: string
  popupProps?: DropdownMenuPopupProps
  positionerProps?: DropdownMenuPositionerProps
}

const blockPresentationMenuEvent = (event: SyntheticEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

const stopMenuEventPropagation = (event: SyntheticEvent) => {
  event.stopPropagation()
}

const composeStepByStepTourEventHandlers = <Event extends SyntheticEvent>(
  handler: ((event: Event) => void) | undefined,
  stepByStepTourHandler: (event: Event) => void,
) => {
  return (event: Event) => {
    handler?.(event)
    stepByStepTourHandler(event)
  }
}

export const getStepByStepTourDropdownMenuContentProps = ({
  highlightPart,
  disableMotion = false,
  interactionMode = 'interactive',
  popupClassName,
  popupProps,
  positionerProps,
}: StepByStepTourDropdownMenuContentProps): Pick<DropdownMenuContentProps, 'popupClassName' | 'popupProps' | 'positionerProps'> => {
  const isPresentation = interactionMode === 'presentation'
  const nextPositionerProps = highlightPart || isPresentation
    ? {
        ...positionerProps,
        ...(highlightPart ? { [STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR]: highlightPart } : undefined),
        ...(isPresentation
          ? {
              onClickCapture: composeStepByStepTourEventHandlers(positionerProps?.onClickCapture, blockPresentationMenuEvent),
              onMouseDownCapture: composeStepByStepTourEventHandlers(positionerProps?.onMouseDownCapture, blockPresentationMenuEvent),
              onPointerDownCapture: composeStepByStepTourEventHandlers(positionerProps?.onPointerDownCapture, blockPresentationMenuEvent),
              onKeyDownCapture: composeStepByStepTourEventHandlers(positionerProps?.onKeyDownCapture, blockPresentationMenuEvent),
            }
          : undefined),
      } as DropdownMenuPositionerProps
    : positionerProps
  const nextPopupProps = isPresentation
    ? {
        ...popupProps,
        'aria-hidden': true,
        'onClickCapture': composeStepByStepTourEventHandlers(popupProps?.onClickCapture, blockPresentationMenuEvent),
        'onMouseDownCapture': composeStepByStepTourEventHandlers(popupProps?.onMouseDownCapture, blockPresentationMenuEvent),
        'onPointerDownCapture': composeStepByStepTourEventHandlers(popupProps?.onPointerDownCapture, blockPresentationMenuEvent),
        'onKeyDownCapture': composeStepByStepTourEventHandlers(popupProps?.onKeyDownCapture, blockPresentationMenuEvent),
      } as DropdownMenuPopupProps
    : {
        ...popupProps,
        onClick: composeStepByStepTourEventHandlers(popupProps?.onClick, stopMenuEventPropagation),
      } as DropdownMenuPopupProps

  return {
    popupClassName: cn(
      popupClassName,
      disableMotion && STEP_BY_STEP_TOUR_MENU_POPUP_NO_MOTION_CLASS_NAME,
      isPresentation && STEP_BY_STEP_TOUR_MENU_PRESENTATION_CLASS_NAME,
    ),
    popupProps: nextPopupProps,
    positionerProps: nextPositionerProps,
  }
}

type StepByStepTourControlledDropdownOptions = {
  allowTriggerCloseWhileControlled?: boolean
  controlledOpen?: boolean
}

type StepByStepTourControlledDropdownState = {
  controlledOpen?: boolean
  open: boolean
}

const getNextDropdownStateForControlledOpen = (
  state: StepByStepTourControlledDropdownState,
  controlledOpen: boolean | undefined,
): StepByStepTourControlledDropdownState => {
  if (state.controlledOpen === controlledOpen)
    return state

  return {
    controlledOpen,
    open: controlledOpen === true
      ? true
      : controlledOpen === false || state.controlledOpen === true
        ? false
        : state.open,
  }
}

export const useStepByStepTourControlledDropdown = (
  {
    allowTriggerCloseWhileControlled = true,
    controlledOpen,
  }: StepByStepTourControlledDropdownOptions = {},
) => {
  const [state, setState] = useState<StepByStepTourControlledDropdownState>(() => ({
    controlledOpen,
    open: controlledOpen === true,
  }))
  const normalizedState = getNextDropdownStateForControlledOpen(state, controlledOpen)
  if (normalizedState !== state)
    setState(normalizedState)

  const onOpenChange = useCallback((nextOpen: boolean) => {
    setState((currentState) => {
      const nextState = getNextDropdownStateForControlledOpen(currentState, controlledOpen)
      if (nextState.controlledOpen && !allowTriggerCloseWhileControlled && !nextOpen)
        return nextState

      return {
        ...nextState,
        open: nextOpen,
      }
    })
  }, [allowTriggerCloseWhileControlled, controlledOpen])

  const close = useCallback(() => {
    setState(currentState => ({
      ...currentState,
      open: false,
    }))
  }, [])

  return {
    close,
    controlled: Boolean(normalizedState.controlledOpen && normalizedState.open),
    open: normalizedState.open,
    onOpenChange,
  }
}
