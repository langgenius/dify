import type { UnsubmittedHumanInputContentProps } from './type'
import ExpirationTime from './expiration-time'
import HumanInputForm from './human-input-form'
import Tips from './tips'

export const UnsubmittedHumanInputContent = ({
  formData,
  showEmailTip = false,
  isEmailDebugMode = false,
  showDebugModeTip = false,
  onSubmit,
}: UnsubmittedHumanInputContentProps) => {
  const { expiration_time } = formData

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
      {/* Expiration Time */}
      {typeof expiration_time === 'number' && (
        <ExpirationTime expirationTime={expiration_time * 1000} />
      )}
    </>
  )
}
