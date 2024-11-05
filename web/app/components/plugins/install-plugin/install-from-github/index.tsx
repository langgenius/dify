'use client'

import React, { useState } from 'react'
import Modal from '@/app/components/base/modal'
import type { Item } from '@/app/components/base/select'
import type { InstallState } from '@/app/components/plugins/types'
import { useGitHubReleases, useGitHubUpload } from '../hooks'
import { parseGitHubUrl } from '../utils'
import type { PluginDeclaration, UpdateFromGitHubPayload } from '../../types'
import { InstallStepFromGitHub } from '../../types'
import Toast from '@/app/components/base/toast'
import SetURL from './steps/setURL'
import SelectPackage from './steps/selectPackage'
import Installed from './steps/installed'
import Loaded from './steps/loaded'
import { useTranslation } from 'react-i18next'

type InstallFromGitHubProps = {
  updatePayload?: UpdateFromGitHubPayload
  onClose: () => void
}

const InstallFromGitHub: React.FC<InstallFromGitHubProps> = ({ updatePayload, onClose }) => {
  const { t } = useTranslation()
  const [state, setState] = useState<InstallState>({
    step: updatePayload ? InstallStepFromGitHub.selectPackage : InstallStepFromGitHub.setUrl,
    repoUrl: updatePayload?.url || '',
    selectedVersion: updatePayload?.currVersion || '',
    selectedPackage: updatePayload?.currPackage || '',
    releases: [],
  })
  const [uniqueIdentifier, setUniqueIdentifier] = useState<string | null>(null)
  const [manifest, setManifest] = useState<PluginDeclaration | null>(null)

  const versions: Item[] = state.releases.map(release => ({
    value: release.tag_name,
    name: release.tag_name,
  }))

  const packages: Item[] = state.selectedVersion
    ? (state.releases
      .find(release => release.tag_name === state.selectedVersion)
      ?.assets
      .map(asset => ({
        value: asset.name,
        name: asset.name,
      })) || [])
    : []

  const { isLoading, handleUpload, error } = useGitHubUpload()
  const { fetchReleases } = useGitHubReleases()

  const handleInstall = async () => {

  }

  const handleNext = async () => {
    switch (state.step) {
      case InstallStepFromGitHub.setUrl: {
        const { isValid, owner, repo } = parseGitHubUrl(state.repoUrl)
        if (!isValid || !owner || !repo) {
          Toast.notify({
            type: 'error',
            message: t('plugin.error.inValidGitHubUrl'),
          })
          break
        }
        await fetchReleases(owner, repo, (fetchedReleases) => {
          setState(prevState => ({
            ...prevState,
            releases: fetchedReleases,
            step: InstallStepFromGitHub.selectPackage,
          }))
        })
        break
      }
      case InstallStepFromGitHub.selectPackage: {
        const repo = state.repoUrl.replace('https://github.com/', '')
        if (error) {
          Toast.notify({
            type: 'error',
            message: error,
          })
        }
        else {
          await handleUpload(repo, state.selectedVersion, state.selectedPackage, (GitHubPackage) => {
            setManifest(GitHubPackage.manifest)
            setUniqueIdentifier(GitHubPackage.uniqueIdentifier)
            setState(prevState => ({ ...prevState, step: InstallStepFromGitHub.loaded }))
          })
        }
        break
      }
      case InstallStepFromGitHub.loaded:
        setState(prevState => ({ ...prevState, step: InstallStepFromGitHub.installed }))
        handleInstall()
        break
      case InstallStepFromGitHub.installed:
        break
    }
  }

  const handleBack = () => {
    setState((prevState) => {
      switch (prevState.step) {
        case InstallStepFromGitHub.selectPackage:
          return { ...prevState, step: InstallStepFromGitHub.setUrl }
        case InstallStepFromGitHub.loaded:
          return { ...prevState, step: InstallStepFromGitHub.selectPackage }
        default:
          return prevState
      }
    })
  }
  return (
    <Modal
      isShow={true}
      onClose={onClose}
      className='flex min-w-[480px] p-0 flex-col items-start rounded-2xl border-[0.5px]
        border-components-panel-border bg-components-panel-bg shadows-shadow-xl'
      closable
    >
      <div className='flex pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
        <div className='flex flex-col items-start gap-1 flex-grow'>
          <div className='self-stretch text-text-primary title-2xl-semi-bold'>
            {t('plugin.installFromGitHub.installPlugin')}
          </div>
          <div className='self-stretch text-text-tertiary system-xs-regular'>
            {state.step !== InstallStepFromGitHub.installed && t('plugin.installFromGitHub.installNote')}
          </div>
        </div>
      </div>
      <div className={`flex px-6 py-3 flex-col justify-center items-start self-stretch ${state.step === InstallStepFromGitHub.installed ? 'gap-2' : 'gap-4'}`}>
        {state.step === InstallStepFromGitHub.setUrl && (
          <SetURL
            repoUrl={state.repoUrl}
            onChange={value => setState(prevState => ({ ...prevState, repoUrl: value }))}
            onNext={handleNext}
            onCancel={onClose}
          />
        )}
        {state.step === InstallStepFromGitHub.selectPackage && (
          <SelectPackage
            isEdit={Boolean(updatePayload)}
            selectedVersion={state.selectedVersion}
            versions={versions}
            onSelectVersion={item => setState(prevState => ({ ...prevState, selectedVersion: item.value as string }))}
            selectedPackage={state.selectedPackage}
            packages={packages}
            onSelectPackage={item => setState(prevState => ({ ...prevState, selectedPackage: item.value as string }))}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
        {state.step === InstallStepFromGitHub.loaded && (
          <Loaded
            isLoading={isLoading}
            payload={manifest as any}
            onBack={handleBack}
            onInstall={handleNext}
          />
        )}
        {state.step === InstallStepFromGitHub.installed && (
          <Installed
            repoUrl={state.repoUrl}
            selectedVersion={state.selectedVersion}
            selectedPackage={state.selectedPackage}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  )
}

export default InstallFromGitHub
