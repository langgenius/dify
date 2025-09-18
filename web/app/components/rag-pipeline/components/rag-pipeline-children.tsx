import {
  memo,
  useState,
} from 'react'
import { useStore } from '../../workflow/store'
import PluginDependency from '../../workflow/plugin-dependency'
import RagPipelinePanel from './panel'
import RagPipelineHeader from './rag-pipeline-header'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import UpdateDSLModal from './update-dsl-modal'
import DSLExportConfirmModal from '@/app/components/workflow/dsl-export-confirm-modal'
import {
  useDSL,
  usePanelInteractions,
} from '@/app/components/workflow/hooks'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import PublishToast from './publish-toast'

const RagPipelineChildren = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])
  const showImportDSLModal = useStore(s => s.showImportDSLModal)
  const setShowImportDSLModal = useStore(s => s.setShowImportDSLModal)
  const {
    handlePaneContextmenuCancel,
  } = usePanelInteractions()
  const {
    exportCheck,
    handleExportDSL,
  } = useDSL()

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === DSL_EXPORT_CHECK)
      setSecretEnvList(v.payload.data as EnvironmentVariable[])
  })

  return (
    <>
      <PluginDependency />
      {
        showImportDSLModal && (
          <UpdateDSLModal
            onCancel={() => setShowImportDSLModal(false)}
            onBackup={exportCheck!}
            onImport={handlePaneContextmenuCancel}
          />
        )
      }
      {
        secretEnvList.length > 0 && (
          <DSLExportConfirmModal
            envList={secretEnvList}
            onConfirm={handleExportDSL!}
            onClose={() => setSecretEnvList([])}
          />
        )
      }
      <RagPipelineHeader />
      <RagPipelinePanel />
      <PublishToast />
    </>
  )
}

export default memo(RagPipelineChildren)
