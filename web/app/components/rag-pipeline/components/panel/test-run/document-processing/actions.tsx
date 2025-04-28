import React from 'react'
import Button from '@/app/components/base/button'
import type { FormType } from '@/app/components/base/form'

type ActionsProps = {
  form: FormType
  onBack: () => void
}

const Actions = ({
  form,
  onBack,
}: ActionsProps) => {
  return (
    <div className='flex items-center justify-end gap-x-2 p-4 pt-2'>
      <Button
        variant='secondary'
        onClick={onBack}
      >
        Back to Data Source
      </Button>
      <Button
        variant='primary'
        onClick={() => {
          form.handleSubmit()
        }}
      >
        Process
      </Button>
    </div>
  )
}

export default React.memo(Actions)
