import React from 'react'
import type { Locale } from '@/i18n-config'
import DevelopMain from '@/app/components/develop'

export type IDevelopProps = {
  params: Promise<{ locale: Locale; appId: string }>
}

const Develop = async (props: IDevelopProps) => {
  const params = await props.params

  const {
    appId,
  } = params

  return <DevelopMain appId={appId} />
}

export default Develop
