import React from 'react'
import { getDictionary } from '@/i18n/server'
import { type Locale } from '@/i18n'
import DevelopMain from '@/app/components/develop'

export type IDevelopProps = {
  params: { locale: Locale; appId: string }
}

const Develop = async ({
  params: { locale, appId },
}: IDevelopProps) => {
  const dictionary = await getDictionary(locale)

  return <DevelopMain appId={appId} dictionary={dictionary} />
}

export default Develop
