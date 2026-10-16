'use client'
import type { PluginCategoryEnum, PluginDeclaration, UpdateFromGitHubPayload } from '../../types'
import type { InstallState } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { toast } from '@/app/notifications'
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
  onSuccess: () => void | Promise<void>
}

const InstallFromGitHub: React.FC<InstallFromGitHubProps> = ({
  updatePayload,
  installContextCategory,
  onClose,
  onSuccess,
}) => {
  const repoUrlInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation(['common', 'plugin'])
  const { getIconUrl } = useGetIcon()
  const { refreshPluginList } = useRefreshPluginList()

  const { modalClassName, foldAnimInto, setIsInstalling, handleStartToInstall } =
    useHideLogic(onClose)

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

  const versions: SelectOption[] = state.releases.map((release) => ({
    value: release.tag_name,
    name: release.tag_name,
  }))

  const packages: SelectOption[] = state.selectedVersion
    ? state.releases
        .find((release) => release.tag_name === state.selectedVersion)
        ?.assets.map((asset) => ({
          value: asset.name,
          name: asset.name,
        })) || []
    : []

  const getTitle = useCallback(() => {
    if (state.step === InstallStepFromGitHub.installed)
      return t(($) => $[`${i18nPrefix}.installedSuccessfully`], { ns: 'plugin' })
    if (state.step === InstallStepFromGitHub.installFailed)
      return t(($) => $[`${i18nPrefix}.installFailed`], { ns: 'plugin' })

    return updatePayload
      ? t(($) => $[`${i18nPrefix}.updatePlugin`], { ns: 'plugin' })
      : t(($) => $[`${i18nPrefix}.installPlugin`], { ns: 'plugin' })
  }, [state.step, t, updatePayload])

  const handleUrlSubmit = async () => {
    const { isValid, owner, repo } = parseGitHubUrl(state.repoUrl)
    if (!isValid || !owner || !repo) {
      toast.error(t(($) => $['error.inValidGitHubUrl'], { ns: 'plugin' }))
      return
    }
    try {
      const fetchedReleases = await fetchReleases(owner, repo)
      if (fetchedReleases.length > 0) {
        setState((prevState) => ({
          ...prevState,
          releases: fetchedReleases,
          step: InstallStepFromGitHub.selectPackage,
        }))
      } else {
        toast.error(t(($) => $['error.noReleasesFound'], { ns: 'plugin' }))
      }
    } catch {
      toast.error(t(($) => $['error.fetchReleasesError'], { ns: 'plugin' }))
    }
  }

  const handleError = (e: any, isInstall: boolean) => {
    const message =
      (e instanceof Error ? e.message : undefined) ||
      t(($) => $['installModal.installFailedDesc'], { ns: 'plugin' })
    setErrorMsg(message)
    setState((prevState) => ({
      ...prevState,
      step: isInstall ? InstallStepFromGitHub.installFailed : InstallStepFromGitHub.uploadFailed,
    }))
  }

  const handleUploaded = async (GitHubPackage: any) => {
    try {
      const icon = await getIconUrl(GitHubPackage.manifest.icon)
      setManifest({
        ...GitHubPackage.manifest,
        icon,
      })
      setUniqueIdentifier(GitHubPackage.uniqueIdentifier)
      setState((prevState) => ({ ...prevState, step: InstallStepFromGitHub.readyToInstall }))
    } catch (e) {
      handleError(e, false)
    }
  }

  const handleUploadFail = useCallback((errorMsg: string) => {
    setErrorMsg(errorMsg)
    setState((prevState) => ({ ...prevState, step: InstallStepFromGitHub.uploadFailed }))
  }, [])

  const handleInstalled = useCallback(
    async (notRefresh?: boolean) => {
      if (!notRefresh) refreshPluginList(manifest)
      await onSuccess()
      setState((prevState) => ({ ...prevState, step: InstallStepFromGitHub.installed }))
      setIsInstalling(false)
    },
    [manifest, onSuccess, refreshPluginList, setIsInstalling],
  )

  const handleFailed = useCallback(
    (errorMsg?: string) => {
      setState((prevState) => ({ ...prevState, step: InstallStepFromGitHub.installFailed }))
      setIsInstalling(false)
      if (errorMsg) setErrorMsg(errorMsg)
    },
    [setIsInstalling],
  )

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

  const completedSteps: InstallStepFromGitHub[] = [
    InstallStepFromGitHub.uploadFailed,
    InstallStepFromGitHub.installed,
    InstallStepFromGitHub.installFailed,
  ]
  const failedSteps: InstallStepFromGitHub[] = [
    InstallStepFromGitHub.uploadFailed,
    InstallStepFromGitHub.installFailed,
  ]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) foldAnimInto()
      }}
    >
      <DialogContent
        initialFocus={repoUrlInputRef}
        backdropProps={{ forceRender: true }}
        className={cn('w-140', modalClassName, 'max-h-[calc(100dvh-48px)]')}
      >
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
          {!completedSteps.includes(state.step) && (
            <DialogDescription>
              {t(($) => $['installFromGitHub.installNote'], { ns: 'plugin' })}
            </DialogDescription>
          )}
          <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        {completedSteps.includes(state.step) ? (
          <Installed
            payload={manifest}
            isFailed={failedSteps.includes(state.step)}
            errMsg={errorMsg}
            installContextCategory={installContextCategory}
            onCancel={onClose}
          />
        ) : state.step === InstallStepFromGitHub.setUrl ? (
          <Form onFormSubmit={handleUrlSubmit}>
            <DialogBody>
              <Field name="repoUrl" className="gap-4">
                <FieldLabel className="flex w-full flex-col items-start justify-center p-0 text-text-secondary">
                  <span className="system-sm-semibold">
                    {t(($) => $['installFromGitHub.gitHubRepo'], { ns: 'plugin' })}
                  </span>
                </FieldLabel>
                <Input
                  ref={repoUrlInputRef}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={state.repoUrl}
                  onValueChange={(value) =>
                    setState((prevState) => ({ ...prevState, repoUrl: value }))
                  }
                  className="flex grow items-center gap-0.5 self-stretch overflow-hidden rounded-lg border-components-input-border-active bg-components-input-bg-active p-2 text-ellipsis"
                  placeholder="Please enter GitHub repo URL"
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" className="min-w-18" onClick={onClose}>
                {t(($) => $['installModal.cancel'], { ns: 'plugin' })}
              </Button>
              <Button
                variant="primary"
                type="submit"
                className="min-w-18"
                disabled={!state.repoUrl.trim()}
              >
                {t(($) => $['installModal.next'], { ns: 'plugin' })}
              </Button>
            </DialogFooter>
          </Form>
        ) : (
          <DialogBody className="flex flex-col items-start gap-4">
            {state.step === InstallStepFromGitHub.selectPackage && (
              <SelectPackage
                updatePayload={updatePayload!}
                repoUrl={state.repoUrl}
                selectedVersion={state.selectedVersion}
                versions={versions}
                onSelectVersion={(item) =>
                  setState((prevState) => ({ ...prevState, selectedVersion: String(item.value) }))
                }
                selectedPackage={state.selectedPackage}
                packages={packages}
                onSelectPackage={(item) =>
                  setState((prevState) => ({ ...prevState, selectedPackage: String(item.value) }))
                }
                onUploaded={handleUploaded}
                onFailed={handleUploadFail}
                onBack={handleBack}
              />
            )}
            {state.step === InstallStepFromGitHub.readyToInstall &&
              manifest &&
              uniqueIdentifier && (
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
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default InstallFromGitHub
