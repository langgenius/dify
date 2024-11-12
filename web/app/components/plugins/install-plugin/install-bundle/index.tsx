'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { InstallStep } from '../../types'
import type { PluginDeclaration } from '../../types'
import SelectPackage from './steps/select-package'

export enum InstallType {
  fromLocal = 'fromLocal',
  fromMarketplace = 'fromMarketplace',
  fromDSL = 'fromDSL',
}

type Props = {
  installType?: InstallType
  plugins?: PluginDeclaration[]
}

const InstallBundle: FC<Props> = ({
  installType = InstallType.fromMarketplace,
  plugins = [],
}) => {
  const [step, setStep] = useState<InstallStep>(installType === InstallType.fromMarketplace ? InstallStep.readyToInstall : InstallStep.uploading)
  const [selectedPlugins, setSelectedPlugins] = useState<PluginDeclaration[]>([])

  const handleSelectedPluginsChange = (plugins: PluginDeclaration[]) => {
    setSelectedPlugins(plugins)
  }
  return (
    <div>
      {step === InstallStep.readyToInstall && (
        <SelectPackage plugins={plugins || []} onChange={handleSelectedPluginsChange} />
      )}
    </div>
  )
}

export default React.memo(InstallBundle)
