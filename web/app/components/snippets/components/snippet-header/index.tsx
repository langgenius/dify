'use client'

import type { HeaderProps } from '@/app/components/workflow/header'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Header from '@/app/components/workflow/header'
import CancelChanges from './cancel-changes'
import Publisher from './publisher'
import RunMode from './run-mode'

type SnippetHeaderProps = {
  snippetId: string
  isPublishing: boolean
  onCancel: () => void
  onPublish: () => void
}

const SnippetHeader = ({
  snippetId,
  isPublishing,
  onCancel,
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
          title: <CancelChanges onCancel={onCancel} />,
          middle: (
            <Publisher
              isPublishing={isPublishing}
              onPublish={onPublish}
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
  }, [isPublishing, onCancel, onPublish, t, viewHistoryProps])

  return <Header {...headerProps} />
}

export default memo(SnippetHeader)
