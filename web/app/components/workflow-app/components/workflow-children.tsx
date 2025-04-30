import {
  memo,
  useState,
} from 'react'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { useStore } from '@/app/components/workflow/store'
import Features from '@/app/components/workflow/features'
import PluginDependency from '@/app/components/workflow/plugin-dependency'
import UpdateDSLModal from '@/app/components/workflow/update-dsl-modal'
import DSLExportConfirmModal from '@/app/components/workflow/dsl-export-confirm-modal'
import {
  useDSL,
  usePanelInteractions,
} from '@/app/components/workflow/hooks'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import WorkflowHeader from './workflow-header'
import WorkflowPanel from './workflow-panel'

const WorkflowChildren = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])
  const showFeaturesPanel = useStore(s => s.showFeaturesPanel)
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
        showFeaturesPanel && <Features />
      }
      {
        showImportDSLModal && (
          <UpdateDSLModal
            onCancel={() => setShowImportDSLModal(false)}
            onBackup={exportCheck}
            onImport={handlePaneContextmenuCancel}
          />
        )
      }
      {
        secretEnvList.length > 0 && (
          <DSLExportConfirmModal
            envList={secretEnvList}
            onConfirm={handleExportDSL}
            onClose={() => setSecretEnvList([])}
          />
        )
      }
      <WorkflowHeader />
      <WorkflowPanel />
    </>
  )
}

export default memo(WorkflowChildren)
