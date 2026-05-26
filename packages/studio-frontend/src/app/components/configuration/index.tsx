'use client'
import * as React from 'react'
import ConfigurationView from '@/app/components/app/configuration/configuration-view'
import { useConfiguration } from '@/app/components/app/configuration/hooks/use-configuration'

const Configuration = () => {
  const viewModel = useConfiguration()
  return <ConfigurationView {...viewModel} />
}

export default React.memo(Configuration)
