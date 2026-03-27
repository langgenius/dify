'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import dynamic from '@/next/dynamic'
import StartTabContent from '../../../start-tab'
import FilePreviewRenderer from './file-preview-renderer'
import { useFileContentController } from './use-file-content-controller'

const FileEditorRenderer = dynamic(
  () => import('./file-editor-renderer'),
  { ssr: false, loading: () => <Loading type="area" /> },
)

type CenteredPanelProps = {
  children: React.ReactNode
  muted?: boolean
}

const CenteredPanel = ({ children, muted = false }: CenteredPanelProps) => (
  <div className={muted
    ? 'flex h-full w-full items-center justify-center bg-components-panel-bg text-text-tertiary'
    : 'flex h-full w-full items-center justify-center bg-components-panel-bg'}
  >
    {children}
  </div>
)

const FileContentPanel = () => {
  const { t } = useTranslation('workflow')
  const state = useFileContentController()

  if (state.kind === 'start')
    return <StartTabContent />

  if (state.kind === 'empty') {
    return (
      <CenteredPanel muted>
        <span className="system-sm-regular">
          {t('skillSidebar.empty')}
        </span>
      </CenteredPanel>
    )
  }

  if (state.kind === 'resolving' || state.kind === 'loading') {
    return (
      <CenteredPanel>
        <Loading type="area" />
      </CenteredPanel>
    )
  }

  if (state.kind === 'missing' || state.kind === 'error') {
    return (
      <CenteredPanel muted>
        <span className="system-sm-regular">
          {t('skillSidebar.loadError')}
        </span>
      </CenteredPanel>
    )
  }

  if (state.kind === 'editor') {
    return (
      <div className="h-full w-full overflow-auto bg-components-panel-bg">
        <FileEditorRenderer state={state} />
      </div>
    )
  }

  if (state.kind !== 'preview')
    return null

  return (
    <div className="h-full w-full overflow-auto bg-components-panel-bg">
      <FilePreviewRenderer state={state} />
    </div>
  )
}

export default React.memo(FileContentPanel)
