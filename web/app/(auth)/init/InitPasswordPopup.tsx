'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { ORPCError } from '@orpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { focusOnArrival } from '@/app/components/auth-shell/focus-on-arrival'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

type InitPasswordFormValues = {
  password: string
}

const isIncorrectPasswordError = (error: Error | null) =>
  error instanceof ORPCError && error.code === 'init_validate_failed'

const InitPasswordPopup = () => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useTranslation(['login', 'common'])
  const pageTitle = t(($) => $.adminInitPassword, { ns: 'login' })
  useDocumentTitle(pageTitle)

  const initStatus = useQuery(consoleQuery.init.get.queryOptions({ retry: false }))
  const isInitFinished = initStatus.data?.status === 'finished'
  const validatePassword = useMutation(
    consoleQuery.init.post.mutationOptions({ context: { silent: true } }),
  )
  const isSubmitting = validatePassword.isPending || validatePassword.isSuccess
  const fieldErrors = useMemo(
    () =>
      isIncorrectPasswordError(validatePassword.error)
        ? { password: t(($) => $['error.initPasswordIncorrect'], { ns: 'login' }) }
        : undefined,
    [validatePassword.error, t],
  )
  const hasFormError = validatePassword.isError && !fieldErrors

  const handleSubmit = ({ password }: InitPasswordFormValues) => {
    if (isSubmitting) return
    validatePassword.mutate(
      { body: { password } },
      {
        onSuccess: () => {
          queryClient.setQueryData(consoleQuery.init.get.queryKey(), { status: 'finished' })
          router.replace('/install')
        },
      },
    )
  }

  const wasFinishedOnArrival = isInitFinished && !validatePassword.isSuccess
  useEffect(() => {
    if (wasFinishedOnArrival) router.replace('/install')
  }, [wasFinishedOnArrival, router])

  return (
    <Form<InitPasswordFormValues>
      className="block min-w-28 sm:mx-12"
      errors={fieldErrors}
      onFormSubmit={handleSubmit}
    >
      <Field
        name="password"
        validate={(value) => (value ? null : t(($) => $['error.passwordEmpty'], { ns: 'login' }))}
        className="mb-4"
      >
        <FieldLabel>{pageTitle}</FieldLabel>
        <Input
          ref={focusOnArrival}
          type="password"
          autoComplete="off"
          onValueChange={() => {
            if (validatePassword.isError) validatePassword.reset()
          }}
        />
        <FieldError />
      </Field>
      {hasFormError && (
        <p role="alert" className="mb-4 system-sm-regular text-text-destructive">
          {t(($) => $['api.actionFailed'], { ns: 'common' })}
        </p>
      )}
      <Button type="submit" variant="primary" loading={isSubmitting} className="w-full">
        {t(($) => $.validate, { ns: 'login' })}
      </Button>
    </Form>
  )
}

export default InitPasswordPopup
