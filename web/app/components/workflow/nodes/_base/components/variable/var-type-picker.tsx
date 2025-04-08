'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { VarType } from '@/app/components/workflow/types'

type Props = {
  className?: string
  readonly: boolean
  value: string
  onChange: (value: string) => void
}

const TYPES = [VarType.string, VarType.number, VarType.arrayNumber, VarType.arrayString, VarType.arrayObject, VarType.object]
const VarReferencePicker: FC<Props> = ({
  readonly,
  className,
  value,
  onChange,
}) => {
  const [open, setOpen] = useState(false)

  const handleChange = useCallback((type: string) => {
    return () => {
      setOpen(false)
      onChange(type)
    }
  }, [onChange])

  return (
    <div className={cn(className, !readonly && 'cursor-pointer select-none')}>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-start'
        offset={4}
      >
        <PortalToFollowElemTrigger onClick={() => setOpen(!open)} className='w-[120px] cursor-pointer'>
          <div className='flex h-8 items-center justify-between rounded-lg border-0 bg-gray-100 px-2.5 text-[13px] text-gray-900'>
            <div className='w-0 grow truncate capitalize' title={value}>{value}</div>
            <RiArrowDownSLine className='h-3.5 w-3.5 shrink-0 text-gray-700' />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent style={{
          zIndex: 100,
        }}>
          <div className='w-[120px] rounded-lg bg-white p-1 shadow-sm'>
            {TYPES.map(type => (
              <div
                key={type}
                className='flex h-[30px] cursor-pointer items-center justify-between rounded-lg pl-3 pr-2 text-[13px] text-gray-900 hover:bg-gray-100'
                onClick={handleChange(type)}
              >
                <div className='w-0 grow truncate capitalize'>{type}</div>
                {type === value && <Check className='h-4 w-4 shrink-0 text-primary-600' />}
              </div>
            ))}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}
export default React.memo(VarReferencePicker)
