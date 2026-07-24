'use client'

import type { PluginDeclaration, UpdateFromGitHubPayload } from '../../types'
import type { Item } from '@/app/components/base/select'
import type { InstallState } from '@/app/components/plugins/types'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { cn } from '@/utils/classnames'
import { InstallStepFromGitHub } from '../../types'
import Installed from '../base/installed'
import { useGitHubReleases } from '../hooks'
import useHideLogic from '../hooks/use-hide-logic'
import useRefreshPluginList from '../hooks/use-refresh-plugin-list'
import { convertRepoToUrl, parseGitHubUrl } from '../utils'
import Loaded from './steps/loaded'
import SelectPackage from './steps/selectPackage'
import SetURL from './steps/setURL'

const i18nPrefix = 'installFromGitHub'

type InstallFromGitHubProps = {
  updatePayload?: UpdateFromGitHubPayload
  onClose: () => void
  onSuccess: () => void
}

const InstallFromGitHub: React.FC<InstallFromGitHubProps> = ({ updatePayload, onClose, onSuccess }) => {
  const { t } = useTranslation()
  const { getIconUrl } = useGetIcon()
  const { fetchReleases } = useGitHubReleases()
  const { refreshPluginList } = useRefreshPluginList()

  const {
    modalClassName,
    foldAnimInto,
    setIsInstalling,
    handleStartToInstall,
  } = useHideLogic(onClose)

  const [state, setState] = useState<InstallState>({
    step: updatePayload ? InstallStepFromGitHub.selectPackage : InstallStepFromGitHub.setUrl,
    repoUrl: updatePayload?.originalPackageInfo?.repo
      ? convertRepoToUrl(updatePayload.originalPackageInfo.repo)
      : '',
    selectedVersion: '',
    selectedPackage: '',
    releases: updatePayload ? updatePayload.originalPackageInfo.releases : [],
  })
  const [uniqueIdentifier, setUniqueIdentifier] = useState<string | null>(null)
  const [manifest, setManifest] = useState<PluginDeclaration | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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

  const getTitle = useCallback(() => {
    if (state.step === InstallStepFromGitHub.installed)
      return t(`${i18nPrefix}.installedSuccessfully`, { ns: 'plugin' })
    if (state.step === InstallStepFromGitHub.installFailed)
      return t(`${i18nPrefix}.installFailed`, { ns: 'plugin' })

    return updatePayload ? t(`${i18nPrefix}.updatePlugin`, { ns: 'plugin' }) : t(`${i18nPrefix}.installPlugin`, { ns: 'plugin' })
  }, [state.step, t, updatePayload])

  const handleUrlSubmit = async () => {
    const { isValid, owner, repo } = parseGitHubUrl(state.repoUrl)
    if (!isValid || !owner || !repo) {
      Toast.notify({
        type: 'error',
        message: t('error.inValidGitHubUrl', { ns: 'plugin' }),
      })
      return
    }
    try {
      const fetchedReleases = await fetchReleases(owner, repo)
      if (fetchedReleases.length > 0) {
        setState(prevState => ({
          ...prevState,
          releases: fetchedReleases,
          step: InstallStepFromGitHub.selectPackage,
        }))
      }
      else {
        Toast.notify({
          type: 'error',
          message: t('error.noReleasesFound', { ns: 'plugin' }),
        })
      }
    }
    catch {
      Toast.notify({
        type: 'error',
        message: t('error.fetchReleasesError', { ns: 'plugin' }),
      })
    }
  }

  const handleError = (e: any, isInstall: boolean) => {
    const message = e?.response?.message || t('installModal.installFailedDesc', { ns: 'plugin' })
    setErrorMsg(message)
    setState(prevState => ({ ...prevState, step: isInstall ? InstallStepFromGitHub.installFailed : InstallStepFromGitHub.uploadFailed }))
  }

  const handleUploaded = async (GitHubPackage: any) => {
    try {
      const icon = await getIconUrl(GitHubPackage.manifest.icon)
      setManifest({
        ...GitHubPackage.manifest,
        icon,
      })
      setUniqueIdentifier(GitHubPackage.uniqueIdentifier)
      setState(prevState => ({ ...prevState, step: InstallStepFromGitHub.readyToInstall }))
    }
    catch (e) {
      handleError(e, false)
    }
  }

  const handleUploadFail = useCallback((errorMsg: string) => {
    setErrorMsg(errorMsg)
    setState(prevState => ({ ...prevState, step: InstallStepFromGitHub.uploadFailed }))
  }, [])

  const handleInstalled = useCallback((notRefresh?: boolean) => {
    setState(prevState => ({ ...prevState, step: InstallStepFromGitHub.installed }))
    if (!notRefresh)
      refreshPluginList(manifest)
    setIsInstalling(false)
    onSuccess()
  }, [manifest, onSuccess, refreshPluginList, setIsInstalling])

  const handleFailed = useCallback((errorMsg?: string) => {
    setState(prevState => ({ ...prevState, step: InstallStepFromGitHub.installFailed }))
    setIsInstalling(false)
    if (errorMsg)
      setErrorMsg(errorMsg)
  }, [setIsInstalling])

  const handleBack = () => {
    setState((prevState) => {
      switch (prevState.step) {
        case InstallStepFromGitHub.selectPackage:
          return { ...prevState, step: InstallStepFromGitHub.setUrl }
        case InstallStepFromGitHub.readyToInstall:
          return { ...prevState, step: InstallStepFromGitHub.selectPackage }
        default:
          return prevState
      }
    })
  }

  return (
    <Modal
      isShow={true}
      onClose={foldAnimInto}
      className={cn(modalClassName, `shadows-shadow-xl flex min-w-[560px] flex-col items-start rounded-2xl border-[0.5px]
        border-components-panel-border bg-components-panel-bg p-0`)}
      closable
    >
      <div className="flex items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6">
        <div className="flex grow flex-col items-start gap-1">
          <div className="title-2xl-semi-bold self-stretch text-text-primary">
            {getTitle()}
          </div>
          <div className="system-xs-regular self-stretch text-text-tertiary">
            {!([InstallStepFromGitHub.uploadFailed, InstallStepFromGitHub.installed, InstallStepFromGitHub.installFailed].includes(state.step)) && t('installFromGitHub.installNote', { ns: 'plugin' })}
          </div>
        </div>
      </div>
      {([InstallStepFromGitHub.uploadFailed, InstallStepFromGitHub.installed, InstallStepFromGitHub.installFailed].includes(state.step))
        ? (
            <Installed
              payload={manifest}
              isFailed={[InstallStepFromGitHub.uploadFailed, InstallStepFromGitHub.installFailed].includes(state.step)}
              errMsg={errorMsg}
              onCancel={onClose}
            />
          )
        : (
            <div className={`flex flex-col items-start justify-center self-stretch px-6 py-3 ${state.step === InstallStepFromGitHub.installed ? 'gap-2' : 'gap-4'}`}>
              {state.step === InstallStepFromGitHub.setUrl && (
                <SetURL
                  repoUrl={state.repoUrl}
                  onChange={value => setState(prevState => ({ ...prevState, repoUrl: value }))}
                  onNext={handleUrlSubmit}
                  onCancel={onClose}
                />
              )}
              {state.step === InstallStepFromGitHub.selectPackage && (
                <SelectPackage
                  updatePayload={updatePayload!}
                  repoUrl={state.repoUrl}
                  selectedVersion={state.selectedVersion}
                  versions={versions}
                  onSelectVersion={item => setState(prevState => ({ ...prevState, selectedVersion: item.value as string }))}
                  selectedPackage={state.selectedPackage}
                  packages={packages}
                  onSelectPackage={item => setState(prevState => ({ ...prevState, selectedPackage: item.value as string }))}
                  onUploaded={handleUploaded}
                  onFailed={handleUploadFail}
                  onBack={handleBack}
                />
              )}
              {state.step === InstallStepFromGitHub.readyToInstall && (
                <Loaded
                  updatePayload={updatePayload!}
                  uniqueIdentifier={uniqueIdentifier!}
                  payload={manifest as any}
                  repoUrl={state.repoUrl}
                  selectedVersion={state.selectedVersion}
                  selectedPackage={state.selectedPackage}
                  onBack={handleBack}
                  onStartToInstall={handleStartToInstall}
                  onInstalled={handleInstalled}
                  onFailed={handleFailed}
                />
              )}
            </div>
          )}
    </Modal>
  )
}

export default InstallFromGitHub
