'use client'
import * as React from 'react'
import HumanInputV2Form from '@/features/human-input-v2-form/form'
import useDocumentTitle from '@/hooks/use-document-title'
import { useParams } from '@/next/navigation'

const FormContent = () => {
  const { token } = useParams<{ token: string }>()
  useDocumentTitle('')

  return <HumanInputV2Form key={token} token={token} />
}

export default React.memo(FormContent)
