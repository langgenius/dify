'use client'

import { Stepper } from '../components/datasets/create/stepper'

export default function Page() {
  return <div className='p-4'>
    <Stepper
      steps={[
        { name: 'Data Source' },
        { name: 'Document Processing' },
        { name: 'Execute & Finish' },
      ]}
      activeStepIndex={1}
    />
  </div>
}
