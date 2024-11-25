'use client'

import { useState } from 'react'
import { InputNumber } from '../components/base/input-number'
// import { Stepper } from '../components/datasets/create/stepper'

export default function Page() {
  const [step, setStep] = useState(0)
  return <div className='p-4'>
    <InputNumber onChange={setStep} unit={'tokens'} />
  </div>
}
