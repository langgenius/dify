'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import type { Props as CreateContentProps } from './create-content'
import CreateContent from './create-content'
import SelectMetadata from './select-metadata'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../../base/portal-to-follow-elem'
import type { MetadataItem } from '../types'
import type { Placement } from '@floating-ui/react'
import { useDatasetMetaData } from '@/service/knowledge/use-metadata'

type Props = {
  datasetId: string
  popupPlacement?: Placement
  popupOffset?: { mainAxis: number, crossAxis: number }
  onSelect: (data: MetadataItem) => void
  onSave: (data: MetadataItem) => void
  trigger: React.ReactNode
  onManage: () => void
} & CreateContentProps

enum Step {
  select = 'select',
  create = 'create',
}

const SelectMetadataModal: FC<Props> = ({
  datasetId,
  popupPlacement = 'left-start',
  popupOffset = { mainAxis: -38, crossAxis: 4 },
  trigger,
  onSelect,
  onSave,
  onManage,
}) => {
  const { data: datasetMetaData } = useDatasetMetaData(datasetId)

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(Step.select)

  const handleSave = useCallback(async (data: MetadataItem) => {
    await onSave(data)
    setStep(Step.select)
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
            onSelect={(data) => {
              onSelect(data)
              setOpen(false)
            }}
            list={datasetMetaData?.doc_metadata || []}
            onNew={() => setStep(Step.create)}
            onManage={onManage}
          />
        ) : (
          <CreateContent
            onSave={handleSave}
            hasBack
            onBack={() => setStep(Step.select)}
            onClose={() => setStep(Step.select)}
          />
        )}
      </PortalToFollowElemContent>
    </PortalToFollowElem >

  )
}
export default React.memo(SelectMetadataModal)
