import { useState } from 'react'
import {
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react'

export const useAddBranch = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [dismissEnable, setDismissEnable] = useState(true)
  const { refs, floatingStyles, context } = useFloating({
    placement: 'bottom',
    strategy: 'fixed',
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [
      flip(),
      shift(),
      offset(4),
    ],
  })
  const dismiss = useDismiss(context, {
    enabled: dismissEnable,
  })
  const { getFloatingProps } = useInteractions([
    dismiss,
  ])

  return {
    refs,
    floatingStyles,
    getFloatingProps,
    isOpen,
    setIsOpen,
    setDismissEnable,
  }
}
