import React from 'react'
import type { Item } from '@/app/components/base/select'
import { PortalSelect } from '@/app/components/base/select'
import Button from '@/app/components/base/button'

type SetVersionProps = {
  selectedVersion: string
  versions: Item[]
  onSelect: (item: Item) => void
  onNext: () => void
  onBack: () => void
}

const SetVersion: React.FC<SetVersionProps> = ({ selectedVersion, versions, onSelect, onNext, onBack }) => (
  <>
    <label
      htmlFor='version'
      className='flex flex-col justify-center items-start self-stretch text-text-secondary'
    >
      <span className='system-sm-semibold'>Select version</span>
    </label>
    <PortalSelect
      value={selectedVersion}
      onSelect={onSelect}
      items={versions}
      placeholder="Please select a version"
      popupClassName='w-[432px] z-[1001]'
    />
    <div className='flex justify-end items-center gap-2 self-stretch mt-4'>
      <Button
        variant='secondary'
        className='min-w-[72px]'
        onClick={onBack}
      >
        Back
      </Button>
      <Button
        variant='primary'
        className='min-w-[72px]'
        onClick={onNext}
        disabled={!selectedVersion}
      >
        Next
      </Button>
    </div>
  </>
)

export default SetVersion
