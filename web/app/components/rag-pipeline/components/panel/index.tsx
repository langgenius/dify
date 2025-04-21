import { useStore } from '@/app/components/workflow/store'
import InputField from './input-field'
import { useMemo } from 'react'
import type { PanelProps } from '@/app/components/workflow/panel'
import Panel from '@/app/components/workflow/panel'

const RagPipelinePanelOnRight = () => {
  const showInputField = useStore(s => s.showInputFieldPanel)

  return (
    <>
      {
        showInputField && (
          <InputField />
        )
      }
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
