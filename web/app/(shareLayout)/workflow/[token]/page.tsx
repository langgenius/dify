import * as React from 'react'

import Main from '@/app/components/share/text-generation'
import AuthenticatedLayout from '../../components/authenticated-layout'

const Workflow = () => {
  return (
    <AuthenticatedLayout>
      <Main isWorkflow />
    </AuthenticatedLayout>
  )
}

export default React.memo(Workflow)
