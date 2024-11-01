'use client'
import React from 'react'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'

const ToolsPicker = () => {
  const [show, setShow] = React.useState(true)
  return (
    <div className=' mt-10 ml-10'>
      <ToolPicker
        trigger={<div className='inline-block w-[70px]'>Click me</div>}
        isShow={show}
        onShowChange={setShow}
        disabled={false}
        supportAddCustomTool={true}
        onSelect={() => { }}
      />
    </div>

  )
}

export default ToolsPicker
