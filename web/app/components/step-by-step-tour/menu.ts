import type { MenuContentProps } from '@langgenius/dify-ui/menu'
import type { SyntheticEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useState } from 'react'

const STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR = 'data-step-by-step-tour-highlight-part'
const STEP_BY_STEP_TOUR_MENU_POPUP_NO_MOTION_CLASS_NAME =
  'transition-none data-starting-style:scale-100 data-starting-style:opacity-100 data-ending-style:scale-100 data-ending-style:opacity-100'
const STEP_BY_STEP_TOUR_MENU_PRESENTATION_CLASS_NAME = 'pointer-events-none cursor-default'

type StepByStepTourMenuContentProps = {
  highlightPart?: string
  disableMotion?: boolean
  interactionMode?: 'interactive' | 'presentation'
  className?: string
}

const blockPresentationMenuEvent = (event: SyntheticEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

const stopMenuEventPropagation = (event: SyntheticEvent) => {
  event.stopPropagation()
}

export const getStepByStepTourMenuContentProps = ({
  highlightPart,
  disableMotion = false,
  interactionMode = 'interactive',
  className,
}: StepByStepTourMenuContentProps): Pick<
  MenuContentProps,
  | 'aria-hidden'
  | 'className'
  | 'onClick'
  | 'onClickCapture'
  | 'onKeyDownCapture'
  | 'onMouseDownCapture'
  | 'onPointerDownCapture'
> & {
  [STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR]?: string
} => {
  const isPresentation = interactionMode === 'presentation'

  return {
    ...(highlightPart
      ? { [STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR]: highlightPart }
      : undefined),
    className: cn(
      className,
      disableMotion && STEP_BY_STEP_TOUR_MENU_POPUP_NO_MOTION_CLASS_NAME,
      isPresentation && STEP_BY_STEP_TOUR_MENU_PRESENTATION_CLASS_NAME,
    ),
    ...(isPresentation
      ? {
          'aria-hidden': true,
          onClickCapture: blockPresentationMenuEvent,
          onMouseDownCapture: blockPresentationMenuEvent,
          onPointerDownCapture: blockPresentationMenuEvent,
          onKeyDownCapture: blockPresentationMenuEvent,
        }
      : { onClick: stopMenuEventPropagation }),
  }
}

type StepByStepTourControlledMenuOptions = {
  allowTriggerCloseWhileControlled?: boolean
  controlledOpen?: boolean
}

type StepByStepTourControlledMenuState = {
  controlledOpen?: boolean
  open: boolean
}

const getNextMenuStateForControlledOpen = (
  state: StepByStepTourControlledMenuState,
  controlledOpen: boolean | undefined,
): StepByStepTourControlledMenuState => {
  if (state.controlledOpen === controlledOpen) return state

  return {
    controlledOpen,
    open:
      controlledOpen === true
        ? true
        : controlledOpen === false || state.controlledOpen === true
          ? false
          : state.open,
  }
}

export const useStepByStepTourControlledMenu = ({
  allowTriggerCloseWhileControlled = true,
  controlledOpen,
}: StepByStepTourControlledMenuOptions = {}) => {
  const [state, setState] = useState<StepByStepTourControlledMenuState>(() => ({
    controlledOpen,
    open: controlledOpen === true,
  }))
  const normalizedState = getNextMenuStateForControlledOpen(state, controlledOpen)
  if (normalizedState !== state) setState(normalizedState)

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      setState((currentState) => {
        const nextState = getNextMenuStateForControlledOpen(currentState, controlledOpen)
        if (nextState.controlledOpen && !allowTriggerCloseWhileControlled && !nextOpen)
          return nextState

        return {
          ...nextState,
          open: nextOpen,
        }
      })
    },
    [allowTriggerCloseWhileControlled, controlledOpen],
  )

  const close = useCallback(() => {
    setState((currentState) => ({
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
