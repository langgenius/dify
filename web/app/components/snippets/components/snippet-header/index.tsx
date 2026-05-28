'use client'

import type { HeaderProps } from '@/app/components/workflow/header'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Header from '@/app/components/workflow/header'
import CancelChanges from './cancel-changes'
import RunMode from './run-mode'

type SnippetHeaderProps = {
  snippetId: string
  hasDraftChanges: boolean
  isEditing: boolean
  isPublishing: boolean
  onCancel: () => void
  onDiscardAndExitEditing: () => void | Promise<void>
  onEdit: () => void
  onExitEditing: () => void | Promise<void>
  onPublish: () => void
  onSaveAndExitEditing: () => void | Promise<void>
}

const ViewOnlyBadge = () => {
  const { t } = useTranslation('snippet')

  return (
    <div className="rounded-md border border-components-badge-status-light-normal-border-inner bg-components-badge-bg-blue-light-soft px-1.5 py-0.5 system-xs-semibold-uppercase text-text-accent">
      {t('viewOnly')}
    </div>
  )
}

const EditActions = ({
  hasDraftChanges,
  isEditing,
  isPublishing,
  onEdit,
  onExitEditing,
  onDiscardAndExitEditing,
  onPublish,
  onSaveAndExitEditing,
}: Pick<SnippetHeaderProps, 'hasDraftChanges' | 'isEditing' | 'isPublishing' | 'onDiscardAndExitEditing' | 'onEdit' | 'onExitEditing' | 'onPublish' | 'onSaveAndExitEditing'>) => {
  const { t } = useTranslation('snippet')
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)

  if (!isEditing) {
    return (
      <Button variant="primary" onClick={onEdit}>
        {t('edit')}
      </Button>
    )
  }

  return (
    <>
      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogTrigger
          render={(
            <Button
              disabled={isPublishing}
              onClick={(event) => {
                if (!hasDraftChanges) {
                  event.preventDefault()
                  void onExitEditing()
                  return
                }

                setExitConfirmOpen(true)
              }}
            >
              {t('exitEditing')}
            </Button>
          )}
        />
        <AlertDialogContent className="w-165">
          <div className="space-y-2 p-8 pb-12">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('saveBeforeLeavingTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-secondary">
              {t('saveBeforeLeavingDescription')}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions className="px-8 pt-0">
            <AlertDialogCancelButton disabled={isPublishing}>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              disabled={isPublishing}
              onClick={async () => {
                await onDiscardAndExitEditing()
                setExitConfirmOpen(false)
              }}
            >
              {t('doNotSave')}
            </AlertDialogConfirmButton>
            <AlertDialogConfirmButton
              tone="default"
              loading={isPublishing}
              disabled={isPublishing}
              onClick={async () => {
                await onSaveAndExitEditing()
                setExitConfirmOpen(false)
              }}
            >
              {t('saveAndExit')}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      <Button
        variant="primary"
        loading={isPublishing}
        disabled={isPublishing}
        onClick={onPublish}
      >
        {t('save')}
      </Button>
    </>
  )
}

const SnippetHeader = ({
  snippetId,
  hasDraftChanges,
  isEditing,
  isPublishing,
  onCancel,
  onDiscardAndExitEditing,
  onEdit,
  onExitEditing,
  onPublish,
  onSaveAndExitEditing,
}: SnippetHeaderProps) => {
  const { t } = useTranslation('snippet')
  const viewHistoryProps = useMemo(() => {
    return {
      historyUrl: `/snippets/${snippetId}/workflow-runs`,
    }
  }, [snippetId])

  const headerProps: HeaderProps = useMemo(() => {
    return {
      normal: {
        components: {
          title: isEditing
            ? (hasDraftChanges ? <CancelChanges onCancel={onCancel} /> : <></>)
            : <ViewOnlyBadge />,
          left: (
            <EditActions
              hasDraftChanges={hasDraftChanges}
              isEditing={isEditing}
              isPublishing={isPublishing}
              onDiscardAndExitEditing={onDiscardAndExitEditing}
              onEdit={onEdit}
              onExitEditing={onExitEditing}
              onPublish={onPublish}
              onSaveAndExitEditing={onSaveAndExitEditing}
            />
          ),
        },
        controls: {
          showEnvButton: false,
          showGlobalVariableButton: false,
        },
        runAndHistoryProps: {
          showRunButton: true,
          runButtonText: t('testRunButton'),
          viewHistoryProps,
          components: {
            RunMode,
          },
        },
      },
      viewHistory: {
        viewHistoryProps,
      },
    }
  }, [hasDraftChanges, isEditing, isPublishing, onCancel, onDiscardAndExitEditing, onEdit, onExitEditing, onPublish, onSaveAndExitEditing, t, viewHistoryProps])

  return <Header {...headerProps} />
}

export default memo(SnippetHeader)
