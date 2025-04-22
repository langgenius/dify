import { useMemo } from 'react'
import type { PanelProps } from '@/app/components/workflow/panel'
import Panel from '@/app/components/workflow/panel'

const RagPipelinePanelOnRight = () => {
  return (
    <>
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
