import HumanInputForm from './human-input-form'
import type { FormData } from './human-input-form'

type Props = {
  formData: FormData
  showDebugTip?: boolean
  showTimeout?: boolean
  onSubmit?: (formID: string, data: any) => void
}

const HumanInputContent = ({ formData, onSubmit }: Props) => {
  return (
    <>
      <HumanInputForm
        formData={formData}
        onSubmit={onSubmit}
      />
    </>
  )
}

export default HumanInputContent
