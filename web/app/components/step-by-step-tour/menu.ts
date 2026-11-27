import type { MenuChangeEventDetails, MenuContentProps } from '@langgenius/dify-ui/menu'
import type { SyntheticEvent } from 'react'
import { useCallback, useState } from 'react'

const STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR = 'data-step-by-step-tour-highlight-part'

type StepByStepTourMenuContentProps = {
  highlightPart?: string
}

const stopMenuEventPropagation = (event: SyntheticEvent) => {
  event.stopPropagation()
}

export const getStepByStepTourMenuContentProps = ({
  highlightPart,
}: StepByStepTourMenuContentProps): Pick<MenuContentProps, 'onClick'> & {
  [STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR]?: string
} => ({
  ...(highlightPart ? { [STEP_BY_STEP_TOUR_HIGHLIGHT_PART_DATA_ATTR]: highlightPart } : undefined),
  onClick: stopMenuEventPropagation,
})

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
    (nextOpen: boolean, eventDetails: Pick<MenuChangeEventDetails, 'reason'>) => {
      setState((currentState) => {
        const nextState = getNextMenuStateForControlledOpen(currentState, controlledOpen)
        if (
          nextState.controlledOpen &&
          !nextOpen &&
          (!allowTriggerCloseWhileControlled || eventDetails.reason !== 'trigger-press')
        )
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
