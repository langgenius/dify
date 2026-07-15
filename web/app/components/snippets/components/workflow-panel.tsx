'use client'

import type { PanelProps } from '@/app/components/workflow/panel'
import type { SnippetInputField } from '@/models/snippet'
import { memo, useMemo } from 'react'
import Panel from '@/app/components/workflow/panel'
import { useStore } from '@/app/components/workflow/store'
import dynamic from '@/next/dynamic'

const Record = dynamic(() => import('@/app/components/workflow/panel/record'), {
  ssr: false,
})
const SnippetRunPanel = dynamic(() => import('./snippet-run-panel'), {
  ssr: false,
})

type SnippetWorkflowPanelProps = {
  snippetId: string
  fields: SnippetInputField[]
}

const SnippetPanelOnRight = ({ fields }: Pick<SnippetWorkflowPanelProps, 'fields'>) => {
  const historyWorkflowData = useStore((s) => s.historyWorkflowData)
  const showDebugAndPreviewPanel = useStore((s) => s.showDebugAndPreviewPanel)

  return (
    <>
      {historyWorkflowData && <Record />}
      {showDebugAndPreviewPanel && <SnippetRunPanel fields={fields} />}
    </>
  )
}

const SnippetWorkflowPanel = ({ snippetId, fields }: SnippetWorkflowPanelProps) => {
  const versionHistoryPanelProps = useMemo(() => {
    return {
      getVersionListUrl: `/snippets/${snippetId}/workflows`,
      deleteVersionUrl: (versionId: string) => `/snippets/${snippetId}/workflows/${versionId}`,
      restoreVersionUrl: (versionId: string) =>
        `/snippets/${snippetId}/workflows/${versionId}/restore`,
      updateVersionUrl: (versionId: string) => `/snippets/${snippetId}/workflows/${versionId}`,
      latestVersionId: '',
    }
  }, [snippetId])

  const panelProps: PanelProps = useMemo(() => {
    return {
      components: {
        right: <SnippetPanelOnRight fields={fields} />,
      },
      versionHistoryPanelProps,
    }
  }, [fields, versionHistoryPanelProps])

  return <Panel {...panelProps} />
}

export default memo(SnippetWorkflowPanel)
