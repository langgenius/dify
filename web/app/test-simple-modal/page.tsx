'use client'
import { useState } from 'react'
import Modal from '@/app/components/base/modal'

export default function TestSimpleModal() {
  const [isShow, setIsShow] = useState(true)

  return (
    <div className="min-h-screen bg-background-body p-8">
      <h1>Simple Modal Test</h1>
      <button onClick={() => setIsShow(true)}>Open Modal</button>

      <Modal
        isShow={isShow}
        onClose={() => setIsShow(false)}
        closable
      >
        <div className="p-4">
          <h2>Test Modal</h2>
          <p>This is a simple modal test.</p>
        </div>
      </Modal>
    </div>
  )
}
