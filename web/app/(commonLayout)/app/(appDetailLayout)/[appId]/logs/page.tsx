import React from 'react'
import Main from '@/app/components/app/log'

export type IProps = {
  params: { appId: string }
}

const Logs = async ({
  params: { appId },
}: IProps) => {
  return (
    <Main appId={appId} />
  )
}

export default Logs
