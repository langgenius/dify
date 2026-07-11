'use client'

import type { HeaderProps } from '@/app/components/workflow/header'
import { Button } from '@langgenius/dify-ui/button'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Header from '@/app/components/workflow/header'
import RunMode from './run-mode'

type SnippetHeaderProps = {
  snippetId: string
  canSave: boolean
  canEdit: boolean
  isPublishing: boolean
  onPublish: () => void
}

const PublishAction = ({
  canSave,
  isPublishing,
  onPublish,
}: Pick<SnippetHeaderProps, 'canSave' | 'isPublishing' | 'onPublish'>) => {
  const { t } = useTranslation('snippet')

  return (
    <Button
      variant="primary"
      loading={isPublishing}
      disabled={isPublishing || !canSave}
      onClick={onPublish}
    >
      {t($ => $.publishButton)}
    </Button>
  )
}

const SnippetHeader = ({
  snippetId,
  canSave,
  canEdit,
  isPublishing,
  onPublish,
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
          left: (
            canEdit
              ? (
                  <PublishAction
                    canSave={canSave}
                    isPublishing={isPublishing}
                    onPublish={onPublish}
                  />
                )
              : null
          ),
        },
        controls: {
          showEnvButton: false,
          showGlobalVariableButton: false,
        },
        runAndHistoryProps: {
          showRunButton: true,
          runButtonText: t($ => $.testRunButton),
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
  }, [canEdit, canSave, isPublishing, onPublish, t, viewHistoryProps])

  return <Header {...headerProps} />
}

export default memo(SnippetHeader)
