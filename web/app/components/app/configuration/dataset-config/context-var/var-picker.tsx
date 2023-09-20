'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export type Props = {
  value: string | undefined
  options: { name: string; value: string; type: string }[]
  onChange: (value: string) => void
}

const VarPicker: FC<Props> = ({
  value,
  options,
  onChange,
}) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top-start'
      offset={{
        mainAxis: 8,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div>{value}</div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        <div>
          {options.map(({ name, value, type }, index) => (
            <div key={index} className='flex' onClick={() => onChange(value)} >
              <div>{type}</div>
              <div>{name}</div>
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(VarPicker)
