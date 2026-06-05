'use client'

import type { HeaderProps } from '@/app/components/workflow/header'
import { Button } from '@langgenius/dify-ui/button'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Header from '@/app/components/workflow/header'
import SaveBeforeLeavingDialog from '../save-before-leaving-dialog'
import CancelChanges from './cancel-changes'
import RunMode from './run-mode'

type SnippetHeaderProps = {
  snippetId: string
  canDiscardChanges: boolean
  canSave: boolean
  hasDraftChanges: boolean
  isEditing: boolean
  isPublishing: boolean
  onCancel: () => void
  onEdit: () => void
  onExitEditing: () => void | Promise<void>
  onExitEditingWithoutSave: () => void | Promise<void>
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
  canSave,
  hasDraftChanges,
  isEditing,
  isPublishing,
  onEdit,
  onExitEditing,
  onExitEditingWithoutSave,
  onPublish,
  onSaveAndExitEditing,
}: Pick<SnippetHeaderProps, 'canSave' | 'hasDraftChanges' | 'isEditing' | 'isPublishing' | 'onEdit' | 'onExitEditing' | 'onExitEditingWithoutSave' | 'onPublish' | 'onSaveAndExitEditing'>) => {
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
      <SaveBeforeLeavingDialog
        open={exitConfirmOpen}
        onOpenChange={setExitConfirmOpen}
        trigger={(
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
        disabled={isPublishing}
        saveDisabled={!canSave}
        loading={isPublishing}
        onDiscard={async () => {
          await onExitEditingWithoutSave()
          setExitConfirmOpen(false)
        }}
        onSave={async () => {
          await onSaveAndExitEditing()
          setExitConfirmOpen(false)
        }}
      />
      <Button
        variant="primary"
        loading={isPublishing}
        disabled={isPublishing || !canSave}
        onClick={onPublish}
      >
        {t('save')}
      </Button>
    </>
  )
}

const SnippetHeader = ({
  snippetId,
  canDiscardChanges,
  canSave,
  hasDraftChanges,
  isEditing,
  isPublishing,
  onCancel,
  onEdit,
  onExitEditing,
  onExitEditingWithoutSave,
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
            ? (hasDraftChanges ? <CancelChanges canDiscardChanges={canDiscardChanges} onCancel={onCancel} /> : <></>)
            : <ViewOnlyBadge />,
          left: (
            <EditActions
              canSave={canSave}
              hasDraftChanges={hasDraftChanges}
              isEditing={isEditing}
              isPublishing={isPublishing}
              onEdit={onEdit}
              onExitEditing={onExitEditing}
              onExitEditingWithoutSave={onExitEditingWithoutSave}
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
  }, [canDiscardChanges, canSave, hasDraftChanges, isEditing, isPublishing, onCancel, onEdit, onExitEditing, onExitEditingWithoutSave, onPublish, onSaveAndExitEditing, t, viewHistoryProps])

  return <Header {...headerProps} />
}

export default memo(SnippetHeader)
