import React from 'react'
import type { Locale } from '@/i18n'
import DevelopMain from '@/app/components/develop'

export type IDevelopProps = {
  params: Promise<{ locale: Locale; appId: string }>
}

const Develop = async ({
  params,
}: IDevelopProps) => {
  const appId = (await params).appId
  return <DevelopMain appId={appId} />
}

export default Develop
