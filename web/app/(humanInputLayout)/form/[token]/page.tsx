'use client'
import * as React from 'react'
import FormContent from './form'

const FormPage = () => {
  return (
    <div className="h-full min-w-75 bg-chatbot-bg pb-[env(safe-area-inset-bottom)]">
      <FormContent />
    </div>
  )
}

export default React.memo(FormPage)
