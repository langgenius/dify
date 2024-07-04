import React from 'react'
import HookConfirm from './hook-confirm'
import usePatchElement from '@/hooks/use-patch-element'

const ElementsHolder = React.memo(React.forwardRef((props, ref) => {
  const [elements, patchElement] = usePatchElement()
  React.useImperativeHandle(
    ref,
    () => ({
      patchElement,
    }),
    [patchElement],
  )
  return <>{elements}</>
}))

type ElementsHolderRef = {
  patchElement: ReturnType<typeof usePatchElement>[1]
}

type FuncWithPromise = { then<T>(resolve: (confirmed: boolean) => T, reject: VoidFunction): Promise<T> }

type HookAPI = (props: { title: string; content: string }) => FuncWithPromise

function useConfirm(): readonly [instance: HookAPI, contextHolder: React.ReactElement] {
  const holderRef = React.useRef<ElementsHolderRef>(null)

  const confirm = React.useCallback(() => {
    return function (props: { title: string; content: string }) {
      // Proxy to promise
      let resolvePromise: (confirmed: boolean) => void
      const promise = new Promise<boolean>((resolve) => {
        resolvePromise = resolve
      })

      const modal = <HookConfirm
        key={`confirm-${Date.now()}`}
        onConfirm={(confirmed) => {
          resolvePromise(confirmed)
        }}
        title={props.title}
        content={props.content} />

      holderRef.current?.patchElement(modal)

      const instance: FuncWithPromise = {
        then: (resolve) => {
          return promise.then(resolve)
        },
      }

      return instance
    }
  }, [])

  const fns = React.useMemo(() => confirm(), [confirm])

  return [fns, <ElementsHolder key="confirm-holder" ref={holderRef}></ElementsHolder>] as const
}

export default useConfirm
