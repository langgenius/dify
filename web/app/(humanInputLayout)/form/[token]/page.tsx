'use client'
import * as React from 'react'
import FormContent from './form'

const FormPage = () => {
  return (
    <div className="h-dvh min-w-75 bg-chatbot-bg px-[max(env(safe-area-inset-left),env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <FormContent />
    </div>
  )
}

export default React.memo(FormPage)
