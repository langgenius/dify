'use client'

import React, { useState } from 'react'
import Apps from '@/app/components/apps'
import Button from '@/app/components/base/button'
import Dialog from '@/app/components/base/dialog'

const AppList = () => {
  const [showDialog, setShowDialog] = useState(false)

  return (
    <>
      <div className="flex items-center justify-center pt-4">
        <Button
          variant="primary"
          onClick={() => setShowDialog(true)}
          useMagnetic
        >
          Test Animations
        </Button>
      </div>
      <Dialog
        show={showDialog}
        onClose={() => setShowDialog(false)}
        title="Animated Dialog"
        useAnimation
      >
        <p>This dialog has a floating and tilting animation.</p>
      </Dialog>
      <Apps />
    </>
  )
}

export default AppList
