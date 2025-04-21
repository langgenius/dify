'use client'

import InputFieldForm from '../components/base/form/form-scenarios/input-field'
// import DemoForm from '../components/base/form/form-scenarios/demo'

export default function Page() {
  return (
    <div className='flex h-screen w-full items-center justify-center p-20'>
      <div className='w-[400px] rounded-lg border border-gray-800 bg-components-panel-bg'>
        <InputFieldForm
          initialData={undefined}
          supportFile
          onCancel={() => { console.log('cancel') }}
          onSubmit={value => console.log('submit', value)}
        />
        {/* <DemoForm /> */}
      </div>
    </div>
  )
}
