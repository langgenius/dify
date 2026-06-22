'use client'

import type { CreateReleaseFormValues } from '../state/types'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { isDeploymentDslImportEnabled } from '../../shared/domain/feature-flags'
import {
  closeCreateReleaseDialogAtom,
  createReleaseDialogOpenAtom,
  createReleaseFormAtom,
  openCreateReleaseDialogAtom,
  useCreateReleaseConfig,
  useCreateReleaseFormApi,
} from '../state'
import { useCreateReleaseForm } from '../state/use-create-release-form'
import { CreateReleaseActions } from './actions'
import { ReleaseContentFeedback } from './content-feedback'
import { ReleaseMetadataFields } from './metadata-fields'
import { workflowSourceAppPickerValue } from './source-app-picker-value'
import { ReleaseSourceSection } from './source-section'
import { useCreateReleaseSubmission } from './use-create-release-submission'

const DEFAULT_SOURCE_RELEASE_PAGE_SIZE = 1

function CreateReleaseCloseButton({ isSubmitting }: {
  isSubmitting: boolean
}) {
  const closeDialog = useSetAtom(closeCreateReleaseDialogAtom)

  function requestClose() {
    if (isSubmitting)
      return

    closeDialog()
  }

  return (
    <DialogCloseButton
      type="button"
      disabled={isSubmitting}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
      }}
    />
  )
}

function CreateReleaseDefaultSourceApp({ formValues }: {
  formValues: CreateReleaseFormValues
}) {
  const { appInstanceId } = useCreateReleaseConfig()
  const form = useCreateReleaseFormApi()
  const isDialogOpen = useAtomValue(createReleaseDialogOpenAtom)
  const latestReleaseQuery = useQuery(consoleQuery.enterprise.releaseService.listReleases.queryOptions({
    input: {
      params: { appInstanceId },
      query: {
        pageNumber: 1,
        resultsPerPage: DEFAULT_SOURCE_RELEASE_PAGE_SIZE,
      },
    },
    enabled: isDialogOpen,
  }))
  const latestSourceAppId = latestReleaseQuery.data?.releases[0]?.sourceAppId
  const defaultSourceAppInput = isDialogOpen && latestSourceAppId
    ? { params: { app_id: latestSourceAppId } }
    : undefined
  const defaultSourceAppQuery = useQuery(defaultSourceAppInput
    ? consoleQuery.apps.byAppId.get.queryOptions({
        input: defaultSourceAppInput,
      })
    : {
        queryFn: skipToken,
        queryKey: ['create-release', 'default-source-app'],
      })
  const defaultSourceApp = latestSourceAppId
    ? workflowSourceAppPickerValue(defaultSourceAppQuery.data, latestSourceAppId)
    : undefined
  const sourceAppLocked = !isDeploymentDslImportEnabled
  const releaseSourceMode = formValues.releaseSourceMode === 'dsl' && !isDeploymentDslImportEnabled
    ? 'sourceApp'
    : formValues.releaseSourceMode

  useEffect(() => {
    if (!isDialogOpen || releaseSourceMode !== 'sourceApp' || !defaultSourceApp)
      return
    if (formValues.sourceApp && (!sourceAppLocked || formValues.sourceApp.id === defaultSourceApp.id))
      return

    form.setFieldValue('sourceApp', defaultSourceApp)
  }, [defaultSourceApp, form, formValues.sourceApp, isDialogOpen, releaseSourceMode, sourceAppLocked])

  return null
}

function CreateReleaseDialogForm() {
  const submitReleaseRef = useRef<(value: CreateReleaseFormValues) => Promise<void> | void>(() => undefined)
  const form = useCreateReleaseForm({
    onSubmit: value => submitReleaseRef.current(value),
  })

  return (
    <ScopeProvider atoms={[[createReleaseFormAtom, form]]}>
      <form.Subscribe selector={state => ({
        isSubmitting: state.isSubmitting,
        values: state.values,
      })}
      >
        {({ isSubmitting, values }) => (
          <CreateReleaseDialogSurface
            formValues={values}
            isSubmitting={isSubmitting}
            submitReleaseRef={submitReleaseRef}
          />
        )}
      </form.Subscribe>
    </ScopeProvider>
  )
}

function CreateReleaseDialogSurface({
  formValues,
  isSubmitting,
  submitReleaseRef,
}: {
  formValues: CreateReleaseFormValues
  isSubmitting: boolean
  submitReleaseRef: {
    current: (value: CreateReleaseFormValues) => Promise<void> | void
  }
}) {
  const open = useAtomValue(createReleaseDialogOpenAtom)
  const openDialog = useSetAtom(openCreateReleaseDialogAtom)
  const closeDialog = useSetAtom(closeCreateReleaseDialogAtom)
  const { t } = useTranslation('deployments')
  const form = useCreateReleaseFormApi()
  const submission = useCreateReleaseSubmission(formValues)
  submitReleaseRef.current = submission.createRelease

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      openDialog()
      return
    }

    if (!isSubmitting)
      closeDialog()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogContent className="top-[18dvh] w-140 max-w-[calc(100vw-32px)] translate-y-0 overflow-hidden p-0">
        <CreateReleaseDefaultSourceApp formValues={formValues} />
        <CreateReleaseCloseButton isSubmitting={isSubmitting} />
        <form
          noValidate
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <div className="border-b border-divider-subtle px-6 py-5 pr-14">
            <div className="min-w-0">
              <DialogTitle className="title-xl-semi-bold text-text-primary">
                {t('versions.createRelease')}
              </DialogTitle>
              <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
                {t('versions.createReleaseDescription')}
              </DialogDescription>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-6 py-5">
            <ReleaseSourceSection />
            <ReleaseContentFeedback />
            <ReleaseMetadataFields />
          </div>

          <CreateReleaseActions />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CreateReleaseDialog() {
  const open = useAtomValue(createReleaseDialogOpenAtom)

  if (!open)
    return null

  return <CreateReleaseDialogForm />
}
