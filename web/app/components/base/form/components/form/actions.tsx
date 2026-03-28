import type { FormType } from '../..'
import { useStore } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { useFormContext } from '../..'
import Button from '../../../button'

export type CustomActionsProps = {
  form: FormType
  isSubmitting: boolean
  canSubmit: boolean
}

type ActionsProps = {
  CustomActions?: (props: CustomActionsProps) => React.ReactNode | React.JSX.Element
}

const Actions = ({
  CustomActions,
}: ActionsProps) => {
  const { t } = useTranslation()
  const form = useFormContext()

  const [isSubmitting, canSubmit] = useStore(form.store, state => [
    state.isSubmitting,
    state.canSubmit,
  ])

  if (CustomActions)
    return CustomActions({ form, isSubmitting, canSubmit })

  return (
    <Button
      variant="primary"
      disabled={isSubmitting || !canSubmit}
      loading={isSubmitting}
      onClick={() => form.handleSubmit()}
    >
      {t('operation.submit', { ns: 'common' })}
    </Button>
  )
}

export default Actions
