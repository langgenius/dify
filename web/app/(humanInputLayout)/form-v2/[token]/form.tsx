'use client'
import * as React from 'react'
import HumanInputV2Form from '@/features/human-input/public/form'
import { useParams } from '@/next/navigation'

const FormContent = () => {
  const { token } = useParams<{ token: string }>()

  return <HumanInputV2Form key={token} token={token} />
}

export default React.memo(FormContent)
