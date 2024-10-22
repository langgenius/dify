import React from 'react'
import type { Item } from '@/app/components/base/select'
import { PortalSelect } from '@/app/components/base/select'
import Button from '@/app/components/base/button'

type SetPackageProps = {
  selectedPackage: string
  packages: Item[]
  onSelect: (item: Item) => void
  onInstall: () => void
  onBack: () => void
}

const SetPackage: React.FC<SetPackageProps> = ({ selectedPackage, packages, onSelect, onInstall, onBack }) => (
  <>
    <label
      htmlFor='package'
      className='flex flex-col justify-center items-start self-stretch text-text-secondary'
    >
      <span className='system-sm-semibold'>Select package</span>
    </label>
    <PortalSelect
      value={selectedPackage}
      onSelect={onSelect}
      items={packages}
      placeholder="Please select a package"
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
        onClick={onInstall}
        disabled={!selectedPackage}
      >
        Install
      </Button>
    </div>
  </>
)

export default SetPackage
