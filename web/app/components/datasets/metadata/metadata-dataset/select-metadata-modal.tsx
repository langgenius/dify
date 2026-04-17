'use client'
import type { FC } from 'react'
import type { MetadataItem } from '../types'
import type { Props as CreateContentProps } from './create-content'
import type { Placement } from '@/app/components/base/ui/placement'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
import { useDatasetMetaData } from '@/service/knowledge/use-metadata'
import CreateContent from './create-content'
import SelectMetadata from './select-metadata'

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
  const triggerElement = React.isValidElement(trigger)
    ? trigger
    : <button type="button">{trigger}</button>
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen)
      setStep(Step.select)
  }, [])

  const handleSave = useCallback(async (data: MetadataItem) => {
    await onSave(data)
    setStep(Step.select)
  }, [onSave])
  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger render={triggerElement as React.ReactElement} />
      <PopoverContent
        placement={popupPlacement}
        sideOffset={popupOffset.mainAxis}
        alignOffset={popupOffset.crossAxis}
        popupClassName="border-none bg-transparent shadow-none"
      >
        {step === Step.select
          ? (
              <SelectMetadata
                onSelect={(data) => {
                  onSelect(data)
                  setOpen(false)
                }}
                list={datasetMetaData?.doc_metadata || []}
                onNew={() => setStep(Step.create)}
                onManage={() => {
                  setOpen(false)
                  setStep(Step.select)
                  onManage()
                }}
              />
            )
          : (
              <CreateContent
                onSave={handleSave}
                hasBack
                onBack={() => setStep(Step.select)}
                onClose={() => setStep(Step.select)}
              />
            )}
      </PopoverContent>
    </Popover>

  )
}
export default React.memo(SelectMetadataModal)
