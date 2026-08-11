import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COUNT_DOWN_TIME_MS, useSetCountdownLeftTime } from '@/app/components/signin/storage'
import { emailRegex, TURNSTILE_SITE_KEY } from '@/config'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { sendEMailLoginCode } from '@/service/common'
import Turnstile from './turnstile'

type MailAndCodeAuthProps = {
  isInvite: boolean
  isCloudEdition: boolean
}

export default function MailAndCodeAuth({ isInvite, isCloudEdition }: MailAndCodeAuthProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const locale = useLocale()
  const setCountdownLeftTime = useSetCountdownLeftTime()
  const turnstileSiteKey = TURNSTILE_SITE_KEY.trim()
  const isTurnstileRequired = isCloudEdition
  const shouldRenderTurnstile = isTurnstileRequired && Boolean(turnstileSiteKey)

  const handleGetEMailVerificationCode = async () => {
    try {
      if (isTurnstileRequired && !turnstileToken) return

      if (!email) {
        toast.error(t(($) => $['error.emailEmpty'], { ns: 'login' }))
        return
      }

      if (!emailRegex.test(email)) {
        toast.error(t(($) => $['error.emailInValid'], { ns: 'login' }))
        return
      }
      setLoading(true)
      const ret = await sendEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        setCountdownLeftTime(`${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('email', encodeURIComponent(email))
        params.set('token', encodeURIComponent(ret.data))
        router.push(`/signin/check-code?${params.toString()}`)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form
      onFormSubmit={() => {
        void handleGetEMailVerificationCode()
      }}
    >
      <Field name="email" disabled={isInvite} className="mb-2">
        <FieldLabel className="my-2 py-0 system-md-semibold text-text-secondary">
          {t(($) => $.email, { ns: 'login' })}
        </FieldLabel>
        <FieldControl
          type="email"
          autoComplete="email"
          spellCheck={false}
          disabled={isInvite}
          value={email}
          placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) as string}
          onValueChange={setEmail}
        />
        {shouldRenderTurnstile && (
          <Turnstile
            siteKey={turnstileSiteKey}
            onVerify={setTurnstileToken}
            onInvalidate={() => {
              setTurnstileToken('')
            }}
          />
        )}
        <div className="mt-3">
          <Button
            type="submit"
            loading={loading}
            disabled={loading || !email || (isTurnstileRequired && !turnstileToken)}
            variant="primary"
            className="w-full"
          >
            {t(($) => $['signup.verifyMail'], { ns: 'login' })}
          </Button>
        </div>
      </Field>
    </Form>
  )
}
