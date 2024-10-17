'use client'

import React, { useMemo, useState } from 'react'
import { RiInformation2Line } from '@remixicon/react'
import Card from '../../card'
import { extensionDallE, modelGPT4, toolNotion } from '../../card/card-mock'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'
import Badge, { BadgeState } from '@/app/components/base/badge/index'

type InstallFromMarketplaceProps = {
  onClose: () => void
}

const InstallFromMarketplace: React.FC<InstallFromMarketplaceProps> = ({ onClose }) => {
  const plugins = useMemo(() => [toolNotion, extensionDallE, modelGPT4], [])
  const [selectedPlugins, setSelectedPlugins] = useState<Set<number>>(new Set())
  const [isInstalling, setIsInstalling] = useState(false)
  const [nextStep, setNextStep] = useState(false)

  const mockInstall = async () => {
    setIsInstalling(true)
    await new Promise(resolve => setTimeout(resolve, 1500))
    setIsInstalling(false)
  }

  const pluginsToShow = useMemo(() => {
    if (plugins.length === 1 || (nextStep && selectedPlugins.size === 1))
      return plugins.length === 1 ? plugins : plugins.filter((_, index) => selectedPlugins.has(index))

    return nextStep ? plugins.filter((_, index) => selectedPlugins.has(index)) : plugins
  }, [plugins, nextStep, selectedPlugins])

  const renderPluginCard = (plugin: any, index: number) => (
    <Card
      key={index}
      installed={nextStep && !isInstalling}
      payload={plugin}
      className='w-full'
      titleLeft={
        plugin.version === plugin.latest_version
          ? (
            <Badge className='mx-1' size="s" state={BadgeState.Default}>{plugin.version}</Badge>
          )
          : (
            <>
              <Badge className='mx-1' size="s" state={BadgeState.Warning}>
                {`${plugin.version} -> ${plugin.latest_version}`}
              </Badge>
              <div className='flex px-0.5 justify-center items-center gap-0.5'>
                <div className='text-text-warning system-xs-medium'>Used in 3 apps</div>
                <RiInformation2Line className='w-4 h-4 text-text-tertiary' />
              </div>
            </>
          )
      }
    />
  )

  return (
    <Modal
      isShow={true}
      onClose={onClose}
      className='flex min-w-[560px] flex-col items-start p-0 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadows-shadow-xl'
      closable
    >
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='self-stretch text-text-primary title-2xl-semi-bold'>
          {nextStep ? (isInstalling ? 'Install plugin' : 'Installation successful') : 'Install plugin'}
        </div>
      </div>
      <div className='flex px-6 py-3 flex-col justify-center items-start gap-4 self-stretch'>
        <div className='flex flex-col items-start gap-2 self-stretch'>
          <div className='text-text-secondary system-md-regular'>
            {(nextStep && !isInstalling)
              ? `The following ${pluginsToShow.length === 1 ? 'plugin has' : `${pluginsToShow.length} plugins have`} been installed successfully`
              : `About to install the following ${pluginsToShow.length === 1 ? 'plugin' : `${pluginsToShow.length} plugins`}`}
          </div>
        </div>
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
          {pluginsToShow.map((plugin, index) => (
            <div key={index} className={`flex ${(plugins.length > 1 && !nextStep) ? 'pl-1 items-center gap-2' : ''} flex-grow`}>
              {(plugins.length > 1 && !nextStep) && (
                <Checkbox
                  checked={selectedPlugins.has(index)}
                  onCheck={() => {
                    const newSelectedPlugins = new Set(selectedPlugins)
                    newSelectedPlugins.has(index) ? newSelectedPlugins.delete(index) : newSelectedPlugins.add(index)
                    setSelectedPlugins(newSelectedPlugins)
                  }}
                />
              )}
              {renderPluginCard(plugin, index)}
            </div>
          ))}
        </div>
      </div>
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        {nextStep
          ? (
            <Button
              variant='primary'
              disabled={isInstalling}
              loading={isInstalling}
              onClick={onClose}
            >
              {isInstalling ? 'Installing...' : 'Close'}
            </Button>
          )
          : (
            <>
              <Button variant='secondary' className='min-w-[72px]' onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant='primary'
                className='min-w-[72px]'
                disabled={plugins.length > 1 && selectedPlugins.size < 1}
                onClick={() => {
                  setNextStep(true)
                  mockInstall()
                }}
              >
                Install
              </Button>
            </>
          )}
      </div>
    </Modal>
  )
}

export default InstallFromMarketplace
