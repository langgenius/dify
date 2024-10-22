'use client'

import React, { useState } from 'react'
import Modal from '@/app/components/base/modal'
import type { Item } from '@/app/components/base/select'
import type { GitHubRepoReleaseResponse } from '@/app/components/plugins/types'
import { InstallStepFromGitHub } from '../../types'
import Toast from '@/app/components/base/toast'
import SetURL from './steps/setURL'
import SetVersion from './steps/setVersion'
import SetPackage from './steps/setPackage'
import Installed from './steps/installed'

type InstallFromGitHubProps = {
  onClose: () => void
}

type GitHubUrlInfo = {
  isValid: boolean
  owner?: string
  repo?: string
}

type InstallState = {
  step: InstallStepFromGitHub
  repoUrl: string
  selectedVersion: string
  selectedPackage: string
  releases: GitHubRepoReleaseResponse[]
}

const InstallFromGitHub: React.FC<InstallFromGitHubProps> = ({ onClose }) => {
  const [state, setState] = useState<InstallState>({
    step: InstallStepFromGitHub.setUrl,
    repoUrl: '',
    selectedVersion: '',
    selectedPackage: '',
    releases: [],
  })

  const versions: Item[] = state.releases.map(release => ({
    value: release.tag_name,
    name: release.tag_name,
  }))

  const packages: Item[] = state.selectedVersion
    ? (state.releases
      .find(release => release.tag_name === state.selectedVersion)
      ?.assets
      .map(asset => ({
        value: asset.browser_download_url,
        name: asset.name,
      })) || [])
    : []

  const parseGitHubUrl = (url: string): GitHubUrlInfo => {
    const githubUrlRegex = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/
    const match = url.match(githubUrlRegex)

    if (match) {
      return {
        isValid: true,
        owner: match[1],
        repo: match[2],
      }
    }

    return { isValid: false }
  }

  const handleInstall = async () => {
    // try {
    //   const response = await installPackageFromGitHub({ repo: state.repoUrl, version: state.selectedVersion, package: state.selectedPackage })
    //   if (response.plugin_unique_identifier) {
    //     setState(prevState => ({...prevState, step: InstallStep.installed}))
    //     console.log('Package installed:')
    //   }
    //   else {
    //     console.error('Failed to install package:')
    //   }
    // }
    // catch (error) {
    //   console.error('Error installing package:')
    // }
    setState(prevState => ({ ...prevState, step: InstallStepFromGitHub.installed }))
  }

  const handleNext = async () => {
    switch (state.step) {
      case InstallStepFromGitHub.setUrl: {
        const { isValid, owner, repo } = parseGitHubUrl(state.repoUrl)
        if (!isValid || !owner || !repo) {
          Toast.notify({
            type: 'error',
            message: 'Invalid GitHub URL. Please enter a valid URL in the format: https://github.com/owner/repo',
          })
          break
        }
        try {
          const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`)
          if (!res.ok)
            throw new Error('Failed to fetch releases')
          const data = await res.json()
          const formattedReleases = data.map((release: any) => ({
            tag_name: release.tag_name,
            assets: release.assets.map((asset: any) => ({
              browser_download_url: asset.browser_download_url,
              id: asset.id,
              name: asset.name,
            })),
          }))
          setState(prevState => ({ ...prevState, releases: formattedReleases, step: InstallStepFromGitHub.setVersion }))
        }
        catch (error) {
          Toast.notify({
            type: 'error',
            message: 'Failed to fetch repository release',
          })
        }
        break
      }
      case InstallStepFromGitHub.setVersion:
        setState(prevState => ({ ...prevState, step: InstallStepFromGitHub.setPackage }))
        break
      case InstallStepFromGitHub.setPackage:
        handleInstall()
        break
    }
  }

  const handleBack = () => {
    setState((prevState) => {
      switch (prevState.step) {
        case InstallStepFromGitHub.setVersion:
          return { ...prevState, step: InstallStepFromGitHub.setUrl }
        case InstallStepFromGitHub.setPackage:
          return { ...prevState, step: InstallStepFromGitHub.setVersion }
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
            Install plugin from GitHub
          </div>
          <div className='self-stretch text-text-tertiary system-xs-regular'>
            {state.step !== InstallStepFromGitHub.installed && 'Please make sure that you only install plugins from a trusted source.'}
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
        {state.step === InstallStepFromGitHub.setVersion && (
          <SetVersion
            selectedVersion={state.selectedVersion}
            versions={versions}
            onSelect={item => setState(prevState => ({ ...prevState, selectedVersion: item.value as string }))}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
        {state.step === InstallStepFromGitHub.setPackage && (
          <SetPackage
            selectedPackage={state.selectedPackage}
            packages={packages}
            onSelect={item => setState(prevState => ({ ...prevState, selectedPackage: item.value as string }))}
            onInstall={handleInstall}
            onBack={handleBack}
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
