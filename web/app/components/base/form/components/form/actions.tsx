import { useStore } from '@tanstack/react-form'
import type { FormType } from '../..'
import { useFormContext } from '../..'
import Button from '../../../button'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  CustomActions?: (form: FormType) => React.ReactNode | React.JSX.Element
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
    return CustomActions(form)

  return (
    <Button
      variant='primary'
      disabled={isSubmitting || !canSubmit}
      loading={isSubmitting}
      onClick={() => form.handleSubmit()}
    >
      {t('common.operation.submit')}
    </Button>
  )
}

export default Actions
