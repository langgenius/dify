import { useMemo } from 'react'
import type { HeaderProps } from '@/app/components/workflow/header'
import Header from '@/app/components/workflow/header'
import InputFieldButton from './input-field-button'

const RagPipelineHeader = () => {
  const headerProps: HeaderProps = useMemo(() => {
    return {
      normal: {
        components: {
          left: <InputFieldButton />,
        },
      },
    }
  }, [])

  return (
    <Header {...headerProps} />
  )
}

export default RagPipelineHeader
