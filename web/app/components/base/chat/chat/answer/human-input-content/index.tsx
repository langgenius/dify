import type { HumanInputContentProps } from './type'
import Divider from '@/app/components/base/divider'
import HumanInputForm from './human-input-form'

const HumanInputContent = ({
  formData,
  showEmailTip = false,
  showDebugModeTip = false,
  showTimeout = false,
  onSubmit,
}: HumanInputContentProps) => {
  return (
    <>
      <HumanInputForm
        formData={formData}
        showTimeout={showTimeout}
        onSubmit={onSubmit}
      />
      {(showEmailTip || showDebugModeTip) && (
        <>
          <Divider className="!my-2 w-[30px]" />
          <div className="space-y-1 pt-1">
            {showEmailTip && <div className="system-xs-regular text-text-secondary">humanInputEmailTip</div>}
            {showDebugModeTip && <div className="system-xs-medium text-text-warning">humanInputWebappTip</div>}
          </div>
        </>
      )}
    </>
  )
}

export default HumanInputContent
