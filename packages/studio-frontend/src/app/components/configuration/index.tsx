'use client'
import * as React from 'react'
import ConfigurationView from '../configuration/configuration-view'
import { useConfiguration } from '../configuration/hooks/use-configuration'

const Configuration = () => {
  const viewModel = useConfiguration()
  return <ConfigurationView {...viewModel} />
}

export default React.memo(Configuration)
