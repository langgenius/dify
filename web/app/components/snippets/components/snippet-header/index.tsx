'use client'

import type { HeaderProps } from '@/app/components/workflow/header'
import {
  memo,
  useMemo,
} from 'react'
import Header from '@/app/components/workflow/header'
import InputFieldButton from './input-field-button'
import Publisher from './publisher'
import RunMode from './run-mode'

type SnippetHeaderProps = {
  snippetId: string
  inputFieldCount: number
  onToggleInputPanel: () => void
  onTogglePublishMenu: () => void
}

const SnippetHeader = ({
  snippetId,
  inputFieldCount,
  onToggleInputPanel,
  onTogglePublishMenu,
}: SnippetHeaderProps) => {
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
          middle: <Publisher onClick={onTogglePublishMenu} />,
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
  }, [inputFieldCount, onToggleInputPanel, onTogglePublishMenu, viewHistoryProps])

  return <Header {...headerProps} />
}

export default memo(SnippetHeader)
