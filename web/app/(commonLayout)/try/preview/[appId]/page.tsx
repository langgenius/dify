import React from 'react'
import Main from '@/app/components/app/configuration/preview'

export type IPreviewProps = {
  params: {
    appId: string
  }
}

async function Preview({ params }: IPreviewProps) {
  const appId = (await params).appId
  return (
    <Main appId={appId} />
  )
}

export default Preview
