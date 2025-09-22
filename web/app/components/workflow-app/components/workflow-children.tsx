import {
  memo,
  useState,
} from 'react'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { useStore } from '@/app/components/workflow/store'
import PluginDependency from '../../workflow/plugin-dependency'
import {
  useDSL,
  usePanelInteractions,
} from '@/app/components/workflow/hooks'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import WorkflowHeader from './workflow-header'
import WorkflowPanel from './workflow-panel'
import dynamic from 'next/dynamic'

const Features = dynamic(() => import('@/app/components/workflow/features'), {
  ssr: false,
})
const UpdateDSLModal = dynamic(() => import('@/app/components/workflow/update-dsl-modal'), {
  ssr: false,
})
const DSLExportConfirmModal = dynamic(() => import('@/app/components/workflow/dsl-export-confirm-modal'), {
  ssr: false,
})

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
      <WorkflowHeader />
      <WorkflowPanel />
    </>
  )
}

export default memo(WorkflowChildren)
