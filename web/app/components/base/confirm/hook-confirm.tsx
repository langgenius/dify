import React, { useState } from 'react'
import Confirm from '.'

type HookConfirmRef = { destroy: () => void }

type HookConfirmProps = { title: string; content: string; onConfirm?: (confirmed: boolean) => void }

const HookConfirm: React.ForwardRefRenderFunction<HookConfirmRef, HookConfirmProps> = (props, ref) => {
  const [isShow, setIsShow] = useState(true)

  React.useImperativeHandle(ref, () => ({
    destroy: close,
  }))

  return <Confirm
    onClose={() => {
      props.onConfirm?.(false)
      setIsShow(false)
    }}
    onCancel={() => {
      props.onConfirm?.(false)
      setIsShow(false)
    }}
    onConfirm={() => {
      props.onConfirm?.(true)
      setIsShow(false)
    }}
    isShow={isShow}
    title={props.title}
    content={props.content} />
}

export default React.forwardRef(HookConfirm)
