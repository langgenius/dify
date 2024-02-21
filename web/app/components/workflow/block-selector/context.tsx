'use client'

import { useCallback, useRef, useState } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react'
import type { OnSelect } from './types'
import BlockSelector from './index'

type UpdateParams = {
  from?: string
  placement?: Placement
  offset?: OffsetOptions
  open?: boolean
  className?: string
  callback?: OnSelect
}
export type BlockSelectorContextValue = {
  from: string
  open: boolean
  setOpen: (open: boolean) => void
  referenceRef: any
  floatingRef: any
  floatingStyles: React.CSSProperties
  getFloatingProps: any
  handleToggle: (v: UpdateParams) => void
}

export const BlockSelectorContext = createContext<BlockSelectorContextValue>({
  from: '',
  open: false,
  setOpen: () => {},
  referenceRef: null,
  floatingRef: null,
  floatingStyles: {},
  getFloatingProps: () => {},
  handleToggle: () => {},
})
export const useBlockSelectorContext = () => useContext(BlockSelectorContext)

type BlockSelectorContextProviderProps = {
  children: React.ReactNode
}
export const BlockSelectorContextProvider = ({
  children,
}: BlockSelectorContextProviderProps) => {
  const [from, setFrom] = useState('node')
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement>('top')
  const [offsetValue, setOffsetValue] = useState<OffsetOptions>(0)
  const [className, setClassName] = useState<string>('')
  const callbackRef = useRef<OnSelect | undefined>(undefined)

  const { refs, floatingStyles, context } = useFloating({
    placement,
    strategy: 'fixed',
    open,
    onOpenChange: setOpen,
    middleware: [
      flip(),
      shift(),
      offset(offsetValue),
    ],
  })
  const dismiss = useDismiss(context)
  const { getFloatingProps } = useInteractions([
    dismiss,
  ])

  const handleToggle = useCallback(({
    from,
    open,
    placement,
    offset,
    className,
    callback,
  }: UpdateParams) => {
    setFrom(from || 'node')
    if (open !== undefined)
      setOpen(open)
    else
      setOpen(v => !v)
    setPlacement(placement || 'top')
    setOffsetValue(offset || 0)
    setClassName(className || '')
    callbackRef.current = callback
  }, [])

  const handleSelect = useCallback<OnSelect>((type) => {
    if (callbackRef.current)
      callbackRef.current(type)
    setOpen(v => !v)
  }, [])

  return (
    <BlockSelectorContext.Provider value={{
      from,
      open,
      setOpen,
      handleToggle,
      referenceRef: refs.setReference,
      floatingRef: refs.setFloating,
      floatingStyles,
      getFloatingProps,
    }}>
      {children}
      {
        open && (from === 'node' || from === 'panel') && (
          <FloatingPortal>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className='z-[1000]'
            >
              <BlockSelector
                className={className}
                onSelect={handleSelect}
              />
            </div>
          </FloatingPortal>
        )
      }
    </BlockSelectorContext.Provider>
  )
}
