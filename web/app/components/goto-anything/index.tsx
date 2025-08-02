'use client'

import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import Modal from '@/app/components/base/modal'
import Input from '@/app/components/base/input'
import { useKeyPress } from 'ahooks'
import { getKeyboardKeyCodeBySystem } from '../workflow/utils'

type Props = {
  onHide?: () => void
}
const Actions = {
  app: {
    key: '@app',
    shortcurt: '@app',
    action: () => console.log('App'),
  },
  knowledge: {
    key: '@knowledge',
    shortcurt: '@kb',
    action: () => console.log('Knowledge'),
  },
  tools: {
    key: '@tools',
    shortcurt: '@tools',
    action: () => console.log('Tools'),
  },
}
const GotoAnything: FC<Props> = ({
  onHide,
}) => {
  const [show, setShow] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Handle key press for opening the modal

  useKeyPress(['esc'], (e) => {
    e.preventDefault()
    setShow(false)
  })

  useKeyPress([`${getKeyboardKeyCodeBySystem('ctrl')}.g`], (e) => {
    e.preventDefault()
    setShow(!show)
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)
    Object.values(Actions).forEach(({ key, action }) => {
      if (e.target.value.startsWith(key))
        action()
    })
  }

  useEffect(() => {
    if (show) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [show])

  return (
    <Modal
      isShow={show}
      onClose={onHide}
      closable={false}
      className='w-[480px] !p-0'
    >
      <div className='shadows-shadow-xl flex w-[480px] flex-col items-start rounded-2xl border border-components-panel-border bg-components-panel-bg'>

        <div className='flex flex-col items-start justify-center gap-4 self-stretch px-2 py-2'>
          <Input
            ref={inputRef}
            value={text}
            placeholder='Type to search...'
            onChange={handleChange}
          />
          <div>

          </div>
        </div>
      </div>
    </Modal>
  )
}

export default GotoAnything
