import type { ExportSecretEnvironmentVariable } from '@/app/components/workflow/export-secret-env-event'
import { memo, useState } from 'react'
import { isExportSecretEnvironmentEvent } from '@/app/components/workflow/export-secret-env-event'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useDSL } from '@/app/components/workflow/hooks/use-DSL'
import { usePanelInteractions } from '@/app/components/workflow/hooks/use-panel-interactions'
import PluginDependency from '@/app/components/workflow/plugin-dependency'
import { useStore } from '@/app/components/workflow/store'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useRagPipelineSearch } from '../hooks/use-rag-pipeline-search'
import PipelineExportConfirmModal from './export-confirm-modal'
import RagPipelinePanel from './panel'
import PublishToast from './publish-toast'
import RagPipelineHeader from './rag-pipeline-header'
import UpdateDSLModal from './update-dsl-modal'

const RagPipelineChildren = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [secretEnvList, setSecretEnvList] = useState<ExportSecretEnvironmentVariable[]>([])
  const showImportDSLModal = useStore((s) => s.showImportDSLModal)
  const setShowImportDSLModal = useStore((s) => s.setShowImportDSLModal)
  const canImportExportDSL = useHooksStore((s) => s.accessControl.canImportExportDSL)
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const { exportCheck, handleExportDSL, isExporting } = useDSL()

  // Initialize RAG pipeline search functionality
  useRagPipelineSearch()

  eventEmitter?.useSubscription((event) => {
    if (isExportSecretEnvironmentEvent(event)) setSecretEnvList(event.payload.data)
  })

  return (
    <>
      <PluginDependency />
      {canImportExportDSL && showImportDSLModal && (
        <UpdateDSLModal
          onCancel={() => setShowImportDSLModal(false)}
          onBackup={exportCheck!}
          onImport={handlePaneContextmenuCancel}
        />
      )}
      {canImportExportDSL && secretEnvList.length > 0 && (
        <PipelineExportConfirmModal
          envList={secretEnvList}
          onConfirm={handleExportDSL!}
          isExporting={isExporting}
          onClose={() => setSecretEnvList([])}
        />
      )}
      <RagPipelineHeader />
      <RagPipelinePanel />
      <PublishToast />
    </>
  )
}

export default memo(RagPipelineChildren)
