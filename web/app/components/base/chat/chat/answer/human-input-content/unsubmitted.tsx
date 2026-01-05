import type { UnsubmittedHumanInputContentProps } from './type'
import ExpirationTime from './expiration-time'
import HumanInputForm from './human-input-form'
import Tips from './tips'

export const UnsubmittedHumanInputContent = ({
  formData,
  showEmailTip = false,
  isEmailDebugMode = false,
  showDebugModeTip = false,
  showTimeout = false,
  expirationTime,
  onSubmit,
}: UnsubmittedHumanInputContentProps) => {
  return (
    <>
      {/* Form */}
      <HumanInputForm
        formData={formData}
        onSubmit={onSubmit}
      />
      {/* Tips */}
      {(showEmailTip || showDebugModeTip) && (
        <Tips
          showEmailTip={showEmailTip}
          isEmailDebugMode={isEmailDebugMode}
          showDebugModeTip={showDebugModeTip}
        />
      )}
      {/* Timeout */}
      {showTimeout && typeof expirationTime === 'number' && (
        <ExpirationTime expirationTime={expirationTime} />
      )}
    </>
  )
}
