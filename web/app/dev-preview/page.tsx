'use client'

import Input from '../components/base/input'
import { OptionCard } from '../components/datasets/create/step-two/option-card'

export default function Page() {
  return <div className='p-4'>
    <OptionCard
      icon={undefined}
      title={'General'}
      description={
        'General text chunking mode, the chunks retrieved and recalled are the same.'
      }
      className='w-[600px]'
      activeHeaderClassName='bg-gradient-to-r from-[#EFF0F9] to-[#F9FAFB]'
      isActive={true}>
      <p
        className='text-[#354052] text-sm font-semibold leading-tight'
      >
        Lorem ipsum
      </p>
      <Input className='mt-2' />
    </OptionCard>
  </div>
}
