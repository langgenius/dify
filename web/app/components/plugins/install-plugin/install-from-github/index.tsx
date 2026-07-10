'use client'

import type { PluginCategoryEnum, PluginDeclaration, UpdateFromGitHubPayload } from '../../types'
import type { InstallState } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { InstallStepFromGitHub } from '../../types'
import Installed from '../base/installed'
import { fetchReleases } from '../hooks'
import useHideLogic from '../hooks/use-hide-logic'
import useRefreshPluginList from '../hooks/use-refresh-plugin-list'
import { convertRepoToUrl, parseGitHubUrl } from '../utils'
import Loaded from './steps/loaded'
import SelectPackage from './steps/selectPackage'

const i18nPrefix = 'installFromGitHub'

type SelectOption = {
  value: string
  name: string
}

type InstallFromGitHubProps = {
  updatePayload?: UpdateFromGitHubPayload
  installContextCategory?: PluginCategoryEnum
  onClose: () => void
  onSuccess: () => void
}

const InstallFromGitHub: React.FC<InstallFromGitHubProps> = ({ updatePayload, installContextCategory, onClose, onSuccess }) => {
  const { t } = useTranslation()
  const { getIconUrl } = useGetIcon()
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

  const versions: SelectOption[] = state.releases.map(release => ({
    value: release.tag_name,
    name: release.tag_name,
  }))

  const packages: SelectOption[] = state.selectedVersion
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
      return t($ => $[`${i18nPrefix}.installedSuccessfully`], { ns: 'plugin' })
    if (state.step === InstallStepFromGitHub.installFailed)
      return t($ => $[`${i18nPrefix}.installFailed`], { ns: 'plugin' })

    return updatePayload ? t($ => $[`${i18nPrefix}.updatePlugin`], { ns: 'plugin' }) : t($ => $[`${i18nPrefix}.installPlugin`], { ns: 'plugin' })
  }, [state.step, t, updatePayload])

  const handleUrlSubmit = async () => {
    const { isValid, owner, repo } = parseGitHubUrl(state.repoUrl)
    if (!isValid || !owner || !repo) {
      toast.error(t($ => $['error.inValidGitHubUrl'], { ns: 'plugin' }))
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
        toast.error(t($ => $['error.noReleasesFound'], { ns: 'plugin' }))
      }
    }
    catch {
      toast.error(t($ => $['error.fetchReleasesError'], { ns: 'plugin' }))
    }
  }

  const handleError = (e: any, isInstall: boolean) => {
    const message = e?.response?.message || t($ => $['installModal.installFailedDesc'], { ns: 'plugin' })
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          foldAnimInto()
      }}
    >
      <DialogContent
        backdropProps={{ forceRender: true }}
        className={cn('w-[560px] max-w-none! overflow-hidden! text-left align-middle', cn(modalClassName, `shadows-shadow-xl flex max-h-[calc(100dvh-48px)] min-w-[560px] flex-col items-start rounded-2xl border-[0.5px]
        border-components-panel-border bg-components-panel-bg p-0`))}
      >
        <DialogCloseButton />

        <div className="flex shrink-0 items-start gap-2 self-stretch pt-6 pr-14 pb-3 pl-6">
          <div className="flex grow flex-col items-start gap-1">
            <div className="self-stretch title-2xl-semi-bold text-text-primary">
              {getTitle()}
            </div>
            <div className="self-stretch system-xs-regular text-text-tertiary">
              {!([InstallStepFromGitHub.uploadFailed, InstallStepFromGitHub.installed, InstallStepFromGitHub.installFailed].includes(state.step)) && t($ => $['installFromGitHub.installNote'], { ns: 'plugin' })}
            </div>
          </div>
        </div>
        {([InstallStepFromGitHub.uploadFailed, InstallStepFromGitHub.installed, InstallStepFromGitHub.installFailed].includes(state.step))
          ? (
              <Installed
                payload={manifest}
                isFailed={[InstallStepFromGitHub.uploadFailed, InstallStepFromGitHub.installFailed].includes(state.step)}
                errMsg={errorMsg}
                installContextCategory={installContextCategory}
                onCancel={onClose}
              />
            )
          : (
              <div className={`flex min-h-0 flex-1 flex-col items-start justify-center self-stretch overflow-y-auto px-6 py-3 ${state.step === InstallStepFromGitHub.installed ? 'gap-2' : 'gap-4'}`}>
                {state.step === InstallStepFromGitHub.setUrl && (
                  <Form
                    onFormSubmit={handleUrlSubmit}
                    className="flex flex-col items-start gap-4 self-stretch"
                  >
                    <Field name="repoUrl" className="gap-4 self-stretch">
                      <FieldLabel className="flex w-full flex-col items-start justify-center p-0 text-text-secondary">
                        <span className="system-sm-semibold">{t($ => $['installFromGitHub.gitHubRepo'], { ns: 'plugin' })}</span>
                      </FieldLabel>
                      <FieldControl
                        autoFocus
                        type="text"
                        inputMode="url"
                        value={state.repoUrl}
                        onValueChange={value => setState(prevState => ({ ...prevState, repoUrl: value }))}
                        className="flex grow items-center gap-0.5 self-stretch overflow-hidden rounded-lg border-components-input-border-active bg-components-input-bg-active p-2 text-ellipsis"
                        placeholder="Please enter GitHub repo URL"
                      />
                    </Field>
                    <div className="mt-4 flex items-center justify-end gap-2 self-stretch">
                      <Button
                        variant="secondary"
                        className="min-w-18"
                        onClick={onClose}
                      >
                        {t($ => $['installModal.cancel'], { ns: 'plugin' })}
                      </Button>
                      <Button
                        variant="primary"
                        type="submit"
                        className="min-w-18"
                        disabled={!state.repoUrl.trim()}
                      >
                        {t($ => $['installModal.next'], { ns: 'plugin' })}
                      </Button>
                    </div>
                  </Form>
                )}
                {state.step === InstallStepFromGitHub.selectPackage && (
                  <SelectPackage
                    updatePayload={updatePayload!}
                    repoUrl={state.repoUrl}
                    selectedVersion={state.selectedVersion}
                    versions={versions}
                    onSelectVersion={item => setState(prevState => ({ ...prevState, selectedVersion: String(item.value) }))}
                    selectedPackage={state.selectedPackage}
                    packages={packages}
                    onSelectPackage={item => setState(prevState => ({ ...prevState, selectedPackage: String(item.value) }))}
                    onUploaded={handleUploaded}
                    onFailed={handleUploadFail}
                    onBack={handleBack}
                  />
                )}
                {state.step === InstallStepFromGitHub.readyToInstall && manifest && uniqueIdentifier && (
                  <Loaded
                    updatePayload={updatePayload!}
                    uniqueIdentifier={uniqueIdentifier}
                    payload={manifest}
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
      </DialogContent>
    </Dialog>
  )
}

export default InstallFromGitHub
