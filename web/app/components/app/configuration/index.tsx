'use client'
import { ToastHost } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import ConfigurationView from './configuration-view'
import { useConfiguration } from './hooks/use-configuration'
import { appConfigurationToastManager } from './toast'

const Configuration = () => {
  const viewModel = useConfiguration()
  return (
    <>
      <ToastHost manager={appConfigurationToastManager} offset={{ top: 60 }} />
      <ConfigurationView {...viewModel} />
    </>
  )
}

export default React.memo(Configuration)
