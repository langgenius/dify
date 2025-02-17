'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import type { Props as CreateContentProps } from './create-content'
import CreateContent from './create-content'
import SelectMetadata from './select-metadata'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../base/portal-to-follow-elem'
import type { MetadataItem } from './types'
import { DataType } from './types'

type Props = {
  onSave: (data: any) => void
  trigger: React.ReactNode
  popupLeft?: number
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
  trigger,
  popupLeft = 4,
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
      placement='left-start'
      offset={{
        mainAxis: popupLeft,
        crossAxis: -38,
      }}
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
