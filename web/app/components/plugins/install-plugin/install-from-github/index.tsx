'use client'

import React, { useState } from 'react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import type { Item } from '@/app/components/base/select'
import { PortalSelect } from '@/app/components/base/select'
import type { GitHubRepoReleaseResponse } from '@/app/components/plugins/types'
import { InstallStep } from '../../types'
import Toast from '@/app/components/base/toast'

type InstallFromGitHubProps = {
  onClose: () => void
}

type GitHubUrlInfo = {
  isValid: boolean
  owner?: string
  repo?: string
}

type InstallState = {
  step: InstallStep
  repoUrl: string
  selectedVersion: string
  selectedPackage: string
  releases: GitHubRepoReleaseResponse[]
}

const InstallFromGitHub: React.FC<InstallFromGitHubProps> = ({ onClose }) => {
  const [state, setState] = useState<InstallState>({
    step: InstallStep.url,
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
    setState(prevState => ({ ...prevState, step: InstallStep.installed }))
  }

  const handleNext = async () => {
    switch (state.step) {
      case InstallStep.url: {
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
          setState(prevState => ({ ...prevState, releases: formattedReleases, step: InstallStep.version }))
        }
        catch (error) {
          Toast.notify({
            type: 'error',
            message: 'Failed to fetch repository release',
          })
        }
        break
      }
      case InstallStep.version:
        setState(prevState => ({ ...prevState, step: InstallStep.package }))
        break
      case InstallStep.package:
        handleInstall()
        break
    }
  }

  const handleBack = () => {
    setState((prevState) => {
      switch (prevState.step) {
        case InstallStep.version:
          return { ...prevState, step: InstallStep.url }
        case InstallStep.package:
          return { ...prevState, step: InstallStep.version }
        default:
          return prevState
      }
    })
  }

  const isInputValid = () => {
    switch (state.step) {
      case InstallStep.url:
        return !!state.repoUrl.trim()
      case InstallStep.version:
        return !!state.selectedVersion
      case InstallStep.package:
        return !!state.selectedPackage
      default:
        return true
    }
  }

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div className='flex items-center gap-3'>
      <div className='flex-shrink-0 w-[72px] items-center gap-2'>
        <div className='text-text-tertiary system-sm-medium truncate'>
          {label}
        </div>
      </div>
      <div className='flex-grow overflow-hidden'>
        <div className='text-text-secondary text-ellipsis system-sm-medium'>
          {value}
        </div>
      </div>
    </div>
  )

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
            {state.step !== InstallStep.installed && 'Please make sure that you only install plugins from a trusted source.'}
          </div>
        </div>
      </div>
      <div className={`flex px-6 py-3 flex-col justify-center items-start self-stretch ${state.step === InstallStep.installed ? 'gap-2' : 'gap-4'}`}>
        {state.step === InstallStep.url && (
          <>
            <label
              htmlFor='repoUrl'
              className='flex flex-col justify-center items-start self-stretch text-text-secondary'
            >
              <span className='system-sm-semibold'>GitHub repository</span>
            </label>
            <input
              type='url'
              id='repoUrl'
              name='repoUrl'
              value={state.repoUrl}
              onChange={e => setState(prevState => ({ ...prevState, repoUrl: e.target.value }))} // TODO: needs to verify the url
              className='flex items-center self-stretch rounded-lg border border-components-input-border-active
                bg-components-input-bg-active shadows-shadow-xs p-2 gap-[2px] flex-grow overflow-hidden
                text-components-input-text-filled text-ellipsis system-sm-regular'
              placeholder='Please enter GitHub repo URL'
            />
          </>
        )}
        {state.step === InstallStep.version && (
          <>
            <label
              htmlFor='version'
              className='flex flex-col justify-center items-start self-stretch text-text-secondary'
            >
              <span className='system-sm-semibold'>Select version</span>
            </label>
            <PortalSelect
              value={state.selectedVersion}
              onSelect={item => setState(prevState => ({ ...prevState, selectedVersion: item.value as string }))}
              items={versions}
              placeholder="Please select a version"
              popupClassName='w-[432px] z-[1001]'
            />
          </>
        )}
        {state.step === InstallStep.package && (
          <>
            <label
              htmlFor='package'
              className='flex flex-col justify-center items-start self-stretch text-text-secondary'
            >
              <span className='system-sm-semibold'>Select package</span>
            </label>
            <PortalSelect
              value={state.selectedPackage}
              onSelect={item => setState(prevState => ({ ...prevState, selectedPackage: item.value as string }))}
              items={packages}
              placeholder="Please select a package"
              popupClassName='w-[432px] z-[1001]'
            />
          </>
        )}
        {state.step === InstallStep.installed && (
          <>
            <div className='text-text-secondary system-md-regular'>The plugin has been installed successfully.</div>
            <div className='flex w-full p-4 flex-col justify-center items-start gap-2 rounded-2xl bg-background-section-burn'>
              {[
                { label: 'Repository', value: state.repoUrl },
                { label: 'Version', value: state.selectedVersion },
                { label: 'Package', value: state.selectedPackage },
              ].map(({ label, value }) => (
                <InfoRow key={label} label={label} value={value} />
              ))}
            </div>
          </>
        )}
      </div>
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        {state.step === InstallStep.installed
          ? (
            <Button
              variant='primary'
              className='min-w-[72px]'
              onClick={onClose}
            >
              Close
            </Button>
          )
          : (
            <>
              <Button
                variant='secondary'
                className='min-w-[72px]'
                onClick={state.step === InstallStep.url ? onClose : handleBack}
              >
                {state.step === InstallStep.url ? 'Cancel' : 'Back'}
              </Button>
              <Button
                variant='primary'
                className='min-w-[72px]'
                onClick={handleNext}
                disabled={!isInputValid()}
              >
                {state.step === InstallStep.package ? 'Install' : 'Next'}
              </Button>
            </>
          )}
      </div>
    </Modal>
  )
}

export default InstallFromGitHub
