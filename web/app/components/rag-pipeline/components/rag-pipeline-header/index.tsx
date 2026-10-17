import type { HeaderProps } from '@/app/components/workflow/header'
import { memo, useMemo } from 'react'
import Header from '@/app/components/workflow/header'
import InputFieldButton from './input-field-button'
import Publisher from './publisher'
import { RunMode } from './run-mode'

const RagPipelineHeader = () => {
  const headerProps: HeaderProps = useMemo(() => {
    return {
      normal: {
        components: {
          left: <InputFieldButton />,
          middle: <Publisher />,
        },
        runAndHistoryProps: {
          showRunButton: true,
          components: {
            RunMode,
          },
        },
      },
      viewHistory: {},
    }
  }, [])

  return <Header {...headerProps} />
}

export default memo(RagPipelineHeader)
