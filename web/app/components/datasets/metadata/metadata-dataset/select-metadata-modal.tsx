'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import type { Props as CreateContentProps } from './create-content'
import CreateContent from './create-content'
import SelectMetadata from './select-metadata'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../../base/portal-to-follow-elem'
import type { MetadataItem } from '../types'
import type { Placement } from '@floating-ui/react'
import { DataType } from '../types'

type Props = {
  popupPlacement?: Placement
  popupOffset?: { mainAxis: number, crossAxis: number }
  onSave: (data: MetadataItem) => void
  trigger: React.ReactNode
} & CreateContentProps

enum Step {
  select = 'select',
  create = 'create',
}

const testMetadataList: MetadataItem[] = [
  { id: '1', name: 'name1', type: DataType.string },
  { id: '2', name: 'name2', type: DataType.number },
  { id: '3', name: 'name3', type: DataType.time },
]

const SelectMetadataModal: FC<Props> = ({
  popupPlacement = 'left-start',
  popupOffset = { mainAxis: -38, crossAxis: 4 },
  trigger,
  onSave,
}) => {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(Step.select)

  const handleSave = useCallback((data: MetadataItem) => {
    onSave(data)
    setOpen(false)
  }, [onSave])
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement={popupPlacement}
      offset={popupOffset}
    >
      <PortalToFollowElemTrigger
        onClick={() => setOpen(!open)}
        className='block'
      >
        {trigger}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        {step === Step.select ? (
          <SelectMetadata
            onSelect={handleSave}
            list={testMetadataList}
            onNew={() => setStep(Step.create)}
            onManage={() => { }}
          />
        ) : (
          <CreateContent
            onSave={handleSave}
            hasBack
            onBack={() => setStep(Step.select)}
          />
        )}
      </PortalToFollowElemContent>
    </PortalToFollowElem >

  )
}
export default React.memo(SelectMetadataModal)
