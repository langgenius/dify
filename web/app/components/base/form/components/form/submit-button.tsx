import { useStore } from '@tanstack/react-form'
import { useFormContext } from '../..'
import Button, { type ButtonProps } from '../../../button'

type SubmitButtonProps = Omit<ButtonProps, 'disabled' | 'loading' | 'onClick'>

const SubmitButton = ({ ...buttonProps }: SubmitButtonProps) => {
  const form = useFormContext()

  const [isSubmitting, canSubmit] = useStore(form.store, state => [
    state.isSubmitting,
    state.canSubmit,
  ])

  return (
    <Button
      disabled={isSubmitting || !canSubmit}
      loading={isSubmitting}
      onClick={() => form.handleSubmit()}
      {...buttonProps}
    />
  )
}

export default SubmitButton
