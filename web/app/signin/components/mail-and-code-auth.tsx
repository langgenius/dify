import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COUNT_DOWN_TIME_MS, useSetCountdownLeftTime } from '@/app/components/signin/storage'
import { emailRegex, TURNSTILE_SITE_KEY } from '@/config'
import { useLocale } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter, useSearchParams } from '@/next/navigation'
import { sendEMailLoginCode } from '@/service/common'
import Turnstile from './turnstile'

type MailAndCodeAuthProps = {
  isInvite: boolean
}

export default function MailAndCodeAuth({ isInvite }: MailAndCodeAuthProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileGeneration, setTurnstileGeneration] = useState(0)
  const locale = useLocale()
  const setCountdownLeftTime = useSetCountdownLeftTime()
  const turnstileSiteKey = TURNSTILE_SITE_KEY.trim()
  const isTurnstileRequired = systemFeatures.deployment_edition === 'CLOUD'
  const shouldRenderTurnstile = isTurnstileRequired && Boolean(turnstileSiteKey)

  const handleGetEMailVerificationCode = async () => {
    if (loading) return
    let shouldResetTurnstile = false
    try {
      setLoading(true)
      shouldResetTurnstile = isTurnstileRequired
      const ret = await sendEMailLoginCode(
        email,
        locale,
        isTurnstileRequired ? turnstileToken : undefined,
      )
      if (ret.result === 'success') {
        setCountdownLeftTime(`${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('email', encodeURIComponent(email))
        params.set('token', encodeURIComponent(ret.data))
        router.push(`/signin/check-code?${params.toString()}`)
        shouldResetTurnstile = false
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
      if (shouldResetTurnstile) {
        setTurnstileToken('')
        setTurnstileGeneration((value) => value + 1)
      }
    }
  }

  return (
    <Form
      onFormSubmit={() => {
        void handleGetEMailVerificationCode()
      }}
    >
      <Field
        name="email"
        disabled={isInvite}
        validate={(value) => {
          const emailValue = String(value)
          return !emailValue || emailRegex.test(emailValue)
            ? null
            : t(($) => $['error.emailInValid'], { ns: 'login' })
        }}
        className={shouldRenderTurnstile ? 'mb-1' : 'mb-4'}
      >
        <FieldLabel>{t(($) => $.email, { ns: 'login' })}</FieldLabel>
        <Input
          type="email"
          autoComplete="email"
          spellCheck={false}
          disabled={isInvite}
          required
          value={email}
          placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) as string}
          onValueChange={setEmail}
        />
        <FieldError>
          {t(($) => $[email ? 'error.emailInValid' : 'error.emailEmpty'], { ns: 'login' })}
        </FieldError>
      </Field>
      {shouldRenderTurnstile && (
        <div className="mb-4">
          <Turnstile
            key={turnstileGeneration}
            action="signin_code"
            siteKey={turnstileSiteKey}
            onVerify={setTurnstileToken}
            onInvalidate={() => {
              setTurnstileToken('')
            }}
            onError={() => {
              setTurnstileToken('')
            }}
          />
        </div>
      )}
      <Button
        type="submit"
        loading={loading}
        disabled={isTurnstileRequired && !turnstileToken}
        variant="primary"
        className="w-full"
      >
        {t(($) => $['signup.verifyMail'], { ns: 'login' })}
      </Button>
    </Form>
  )
}
