'use client'

import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { basePath } from '@/utils/var'

export default function CreateWorkspace() {
  const { t } = useTranslation(['common'])
  const createWorkspace = useMutation(
    consoleQuery.workspaces.activate.post.mutationOptions({
      context: { silent: true },
      onSuccess: () => {
        window.location.assign(`${basePath}/`)
      },
    }),
  )
  const submitting = createWorkspace.isPending || createWorkspace.isSuccess

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="space-y-2">
        <h1 className="title-4xl-semi-bold text-text-primary">
          {t(($) => $['workspace.create.title'], { ns: 'common' })}
        </h1>
        <p className="body-md-regular text-text-tertiary">
          {t(($) => $['workspace.create.description'], { ns: 'common' })}
        </p>
      </div>
      <Form<{ workspaceName: string }>
        className="flex flex-col gap-6"
        validationMode="onBlur"
        onFormSubmit={({ workspaceName }) => {
          if (submitting) return
          createWorkspace.mutate({ body: { name: workspaceName.trim() } })
        }}
      >
        <Field
          name="workspaceName"
          className="gap-2"
          validate={(value) =>
            typeof value === 'string' && value.trim()
              ? undefined
              : t(($) => $['workspace.create.nameRequired'], { ns: 'common' })
          }
        >
          <FieldLabel className="py-0.5 system-md-medium">
            {t(($) => $['workspace.create.name'], { ns: 'common' })}
            <span
              aria-hidden="true"
              className="ms-1 system-xs-regular text-text-destructive-secondary"
            >
              *
            </span>
          </FieldLabel>
          <Input
            required
            maxLength={255}
            readOnly={submitting}
            autoComplete="organization"
            className="h-9 rounded-lg px-3.5 system-md-regular"
            placeholder={t(($) => $['workspace.create.namePlaceholder'], { ns: 'common' })}
          />
          <FieldError>{t(($) => $['workspace.create.nameRequired'], { ns: 'common' })}</FieldError>
        </Field>
        {createWorkspace.error && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {createWorkspace.error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
          </p>
        )}
        <div className="flex flex-col items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            size="large"
            loading={submitting}
            className="h-auto min-h-9 w-full py-2 whitespace-normal"
          >
            {t(($) => $['workspace.create.continue'], { ns: 'common' })}
          </Button>
          <Link
            href="/my-apps"
            className={cn(buttonVariants({ variant: 'ghost' }), 'w-full text-text-tertiary')}
          >
            {t(($) => $['workspace.create.backToMyApps'], { ns: 'common' })}
          </Link>
        </div>
      </Form>
    </div>
  )
}
