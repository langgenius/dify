'use client'

import type { HeaderProps } from '@/app/components/workflow/header'
import type { SnippetDetailUIModel } from '@/models/snippet'
import {
  memo,
  useMemo,
} from 'react'
import Header from '@/app/components/workflow/header'
import { useStore } from '@/app/components/workflow/store'
import InputFieldButton from './input-field-button'
import Publisher from './publisher'
import RunMode from './run-mode'

type SnippetHeaderProps = {
  snippetId: string
  inputFieldCount: number
  uiMeta: SnippetDetailUIModel
  isPublishMenuOpen: boolean
  isPublishing: boolean
  onToggleInputPanel: () => void
  onPublishMenuOpenChange: (open: boolean) => void
  onPublish: () => void
}

const SnippetHeader = ({
  snippetId,
  inputFieldCount,
  uiMeta,
  isPublishMenuOpen,
  isPublishing,
  onToggleInputPanel,
  onPublishMenuOpenChange,
  onPublish,
}: SnippetHeaderProps) => {
  const draftUpdatedAt = useStore(state => state.draftUpdatedAt)
  const publishedAt = useStore(state => state.publishedAt)
  const viewHistoryProps = useMemo(() => {
    return {
      historyUrl: `/snippets/${snippetId}/workflow-runs`,
    }
  }, [snippetId])

  const headerProps: HeaderProps = useMemo(() => {
    return {
      normal: {
        components: {
          left: <InputFieldButton count={inputFieldCount} onClick={onToggleInputPanel} />,
          middle: (
            <Publisher
              uiMeta={uiMeta}
              draftUpdatedAt={draftUpdatedAt}
              open={isPublishMenuOpen}
              isPublishing={isPublishing}
              onOpenChange={onPublishMenuOpenChange}
              onPublish={onPublish}
              publishedAt={publishedAt}
            />
          ),
        },
        controls: {
          showEnvButton: false,
          showGlobalVariableButton: false,
        },
        runAndHistoryProps: {
          showRunButton: true,
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
  }, [draftUpdatedAt, inputFieldCount, isPublishMenuOpen, isPublishing, onPublish, onPublishMenuOpenChange, onToggleInputPanel, publishedAt, uiMeta, viewHistoryProps])

  return <Header {...headerProps} />
}

export default memo(SnippetHeader)
