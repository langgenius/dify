import React from 'react'
import { type Locale } from '@/i18n'
import DevelopMain from '@/app/components/develop'

export type IDevelopProps = {
  params: { locale: Locale; appId: string }
}

const Develop = async ({
  params: { appId },
}: IDevelopProps) => {
  return <DevelopMain appId={appId} />
}

export default Develop
