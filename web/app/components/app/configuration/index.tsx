'use client'
import * as React from 'react'
import { AppToastHost } from '@/app/notifications/host'
import ConfigurationView from './configuration-view'
import { useConfiguration } from './hooks/use-configuration'
import { appConfigurationToastManager } from './toast'

const Configuration = () => {
  const viewModel = useConfiguration()
  return (
    <>
      <AppToastHost manager={appConfigurationToastManager} offset={{ top: 60 }} />
      <ConfigurationView {...viewModel} />
    </>
  )
}

export default React.memo(Configuration)
