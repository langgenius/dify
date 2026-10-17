'use client'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { Suspense, useId } from 'react'
import { useTranslation } from 'react-i18next'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

type ApiKeyDialogContentProps = Pick<DialogContentProps, 'children' | 'finalFocus'> & {
  limitDescription?: string
  closeDisabled?: boolean
}

export function ApiKeyDialogContent({
  limitDescription,
  closeDisabled,
  children,
  finalFocus,
}: ApiKeyDialogContentProps) {
  const { t } = useTranslation(['appApi', 'common'])
  return (
    <DialogContent finalFocus={finalFocus} className="w-200">
      <DialogHeader>
        <DialogTitle>{t(($) => $['apiKeyModal.apiSecretKey'])}</DialogTitle>
        <DialogDescription>
          {t(($) => $['apiKeyModal.apiSecretKeyTips'])}
          {limitDescription && <span className="block">{limitDescription}</span>}
        </DialogDescription>
        <DialogCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={closeDisabled}
        />
      </DialogHeader>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <ErrorBoundary
            onReset={reset}
            fallback={(_error, retry) => (
              <div className="flex items-center gap-2 border-y border-divider-subtle px-6 py-4">
                <p role="status">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
                <Button variant="secondary" size="small" onClick={retry}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </div>
            )}
          >
            <Suspense
              fallback={
                <div role="status" className="border-y border-divider-subtle px-6 py-4">
                  <span className="sr-only">{t(($) => $.loading, { ns: 'common' })}</span>
                  <SkeletonContainer aria-hidden>
                    {[0, 1, 2].map((row) => (
                      <SkeletonRow key={row} className="gap-6 py-2">
                        <SkeletonRectangle className="w-1/3" />
                        <SkeletonRectangle className="w-1/4" />
                        <SkeletonRectangle className="w-1/4" />
                      </SkeletonRow>
                    ))}
                  </SkeletonContainer>
                </div>
              }
            >
              {children}
            </Suspense>
          </ErrorBoundary>
        )}
      </QueryErrorResetBoundary>
    </DialogContent>
  )
}

export const API_KEY_LIMIT = 10

type ApiKeyCreateActionProps = Pick<
  ButtonProps,
  'ref' | 'disabled' | 'loading' | 'onClick' | 'focusableWhenDisabled'
> & {
  atLimit?: boolean
}

export function ApiKeyCreateAction({
  atLimit = false,
  disabled,
  ...props
}: ApiKeyCreateActionProps) {
  const { t } = useTranslation(['appApi'])
  const descriptionId = useId()

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4">
      <Button
        {...props}
        className="shrink-0"
        disabled={disabled || atLimit}
        aria-describedby={atLimit ? descriptionId : undefined}
      >
        <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
        {t(($) => $['apiKeyModal.createNewSecretKey'])}
      </Button>
      {atLimit && (
        <p id={descriptionId} className="min-w-40 flex-1 system-xs-regular text-text-tertiary">
          {t(($) => $['apiKeyModal.keyLimitReached'])}
        </p>
      )}
    </div>
  )
}
