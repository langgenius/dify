import { useMemo } from 'react'
import type { PanelProps } from '@/app/components/workflow/panel'
import Panel from '@/app/components/workflow/panel'
import { useStore } from '@/app/components/workflow/store'
import TestRunPanel from './test-run'

const RagPipelinePanelOnRight = () => {
  const showTestRunPanel = useStore(s => s.showTestRunPanel)
  return (
    <>
      {showTestRunPanel && <TestRunPanel />}
    </>
  )
}

const RagPipelinePanel = () => {
  const panelProps: PanelProps = useMemo(() => {
    return {
      components: {
        left: null,
        right: <RagPipelinePanelOnRight />,
      },
    }
  }, [])

  return (
    <Panel {...panelProps} />
  )
}

export default RagPipelinePanel
