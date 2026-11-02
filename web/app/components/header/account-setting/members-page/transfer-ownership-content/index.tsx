import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleClient } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import MemberSelector from './member-selector'

const STEP = {
  start: 'start',
  verify: 'verify',
  transfer: 'transfer',
}
type Step = (typeof STEP)[keyof typeof STEP]

const TransferOwnershipContent = () => {
  const { t } = useTranslation(['common', 'workspaceMembers'])
  const verificationCodeInputId = React.useId()
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const [step, setStep] = useState<Step>(STEP.start)
  const [code, setCode] = useState<string>('')
  const [time, setTime] = useState<number>(0)
  const [stepToken, setStepToken] = useState<string>('')
  const [newOwner, setNewOwner] = useState<string>('')
  const [isTransfer, setIsTransfer] = useState<boolean>(false)
  const timerIdRef = React.useRef<number | undefined>(undefined)
  const retimeCountdown = useCallback((timerId?: number) => {
    if (timerIdRef.current !== undefined) window.clearInterval(timerIdRef.current)
    timerIdRef.current = timerId
  }, [])
  React.useEffect(() => {
    return retimeCountdown
  }, [retimeCountdown])
  const startCount = () => {
    setTime(60)
    retimeCountdown(
      window.setInterval(() => {
        setTime((prev) => {
          if (prev <= 1) {
            retimeCountdown()
            return 0
          }
          return prev - 1
        })
      }, 1000),
    )
  }
  const { mutate: sendEmail, isPending: isSendingCode } = useMutation({
    mutationFn: () =>
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post({ body: {} }),
  })
  const verifyEmailAddress = async (code: string, token: string, callback?: () => void) => {
    try {
      const res = await consoleClient.workspaces.current.members.ownerTransferCheck.post(
        {
          body: { code, token },
        },
        { context: { silent: true } },
      )
      if (res.is_valid) {
        setStepToken(res.token)
        callback?.()
      } else {
        toast.error('Verifying email failed')
      }
    } catch (error) {
      toast.error(`Error verifying email: ${getErrorMessage(error) ?? ''}`)
    }
  }
  const sendCodeToOriginEmail = () => {
    sendEmail(undefined, {
      onSuccess: (res) => {
        startCount()
        if (res.data) setStepToken(res.data)
        setStep(STEP.verify)
      },
    })
  }
  const handleVerifyOriginEmail = async () => {
    await verifyEmailAddress(code, stepToken, () => setStep(STEP.transfer))
    setCode('')
  }
  const handleTransfer = async () => {
    setIsTransfer(true)
    try {
      await consoleClient.workspaces.current.members.byMemberId.ownerTransfer.post(
        {
          params: { member_id: newOwner },
          body: { token: stepToken },
        },
        { context: { silent: true } },
      )
      globalThis.location.reload()
    } catch (error) {
      toast.error(`Error ownership transfer: ${getErrorMessage(error) ?? ''}`)
    } finally {
      setIsTransfer(false)
    }
  }
  return (
    <>
      {step === STEP.start && (
        <>
          <DialogHeader>
            <DialogTitle>
              {t(($) => $['members.transferModal.title'], { ns: 'workspaceMembers' })}
            </DialogTitle>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-1 pt-1 pb-2">
              <div className="body-md-medium text-text-destructive">
                {t(($) => $['members.transferModal.warning'], {
                  ns: 'workspaceMembers',
                  workspace: currentWorkspace.name.replace(/'/g, '’'),
                })}
              </div>
              <div className="body-md-regular text-text-secondary">
                {t(($) => $['members.transferModal.warningTip'], { ns: 'workspaceMembers' })}
              </div>
              <div className="body-md-regular text-text-secondary">
                <Trans
                  i18nKey={($) => $['members.transferModal.sendTip']}
                  ns="workspaceMembers"
                  components={{
                    email: <span className="body-md-medium text-text-primary"></span>,
                  }}
                  values={{ email: userProfile.email }}
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter className="flex-col items-stretch">
            <Button variant="primary" loading={isSendingCode} onClick={sendCodeToOriginEmail}>
              {t(($) => $['members.transferModal.sendVerifyCode'], { ns: 'workspaceMembers' })}
            </Button>
            <DialogClose render={<Button />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
          </DialogFooter>
        </>
      )}
      {step === STEP.verify && (
        <>
          <DialogHeader>
            <DialogTitle>
              {t(($) => $['members.transferModal.verifyEmail'], { ns: 'workspaceMembers' })}
            </DialogTitle>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogBody>
            <div className="pt-1 pb-2">
              <div className="body-md-regular text-text-secondary">
                <Trans
                  i18nKey={($) => $['members.transferModal.verifyContent']}
                  ns="workspaceMembers"
                  components={{
                    email: <span className="body-md-medium text-text-primary"></span>,
                  }}
                  values={{ email: userProfile.email }}
                />
              </div>
              <div className="body-md-regular text-text-secondary">
                {t(($) => $['members.transferModal.verifyContent2'], { ns: 'workspaceMembers' })}
              </div>
            </div>
            <div className="pt-3">
              <label
                htmlFor={verificationCodeInputId}
                className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary"
              >
                {t(($) => $['members.transferModal.codeLabel'], { ns: 'workspaceMembers' })}
              </label>
              <Input
                id={verificationCodeInputId}
                name="verification-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="w-full!"
                placeholder={t(($) => $['members.transferModal.codePlaceholder'], {
                  ns: 'workspaceMembers',
                })}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
              />
            </div>
          </DialogBody>
          <DialogFooter className="flex-col items-stretch">
            <Button
              disabled={code.length !== 6}
              variant="primary"
              onClick={handleVerifyOriginEmail}
            >
              {t(($) => $['members.transferModal.continue'], { ns: 'workspaceMembers' })}
            </Button>
            <DialogClose render={<Button />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <div className="flex items-center gap-1 system-xs-regular text-text-tertiary">
              <span>
                {t(($) => $['members.transferModal.resendTip'], { ns: 'workspaceMembers' })}
              </span>
              {time > 0 && (
                <span>
                  {t(($) => $['members.transferModal.resendCount'], {
                    ns: 'workspaceMembers',
                    count: time,
                  })}
                </span>
              )}
              {!time && (
                <button
                  type="button"
                  onClick={sendCodeToOriginEmail}
                  disabled={isSendingCode}
                  className="cursor-pointer border-none bg-transparent p-0 text-start system-xs-medium text-text-accent-secondary"
                >
                  {t(($) => $['members.transferModal.resend'], { ns: 'workspaceMembers' })}
                </button>
              )}
            </div>
          </DialogFooter>
        </>
      )}
      {step === STEP.transfer && (
        <>
          <DialogHeader>
            <DialogTitle>
              {t(($) => $['members.transferModal.title'], { ns: 'workspaceMembers' })}
            </DialogTitle>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-1 pt-1 pb-2">
              <div className="body-md-medium text-text-destructive">
                {t(($) => $['members.transferModal.warning'], {
                  ns: 'workspaceMembers',
                  workspace: currentWorkspace.name.replace(/'/g, '’'),
                })}
              </div>
              <div className="body-md-regular text-text-secondary">
                {t(($) => $['members.transferModal.warningTip'], { ns: 'workspaceMembers' })}
              </div>
            </div>
            <div className="pt-3">
              <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
                {t(($) => $['members.transferModal.transferLabel'], { ns: 'workspaceMembers' })}
              </div>
              <MemberSelector exclude={[userProfile.id]} value={newOwner} onSelect={setNewOwner} />
            </div>
          </DialogBody>
          <DialogFooter className="flex-col items-stretch">
            <Button
              disabled={!newOwner || isTransfer}
              variant="primary"
              tone="destructive"
              onClick={handleTransfer}
            >
              {t(($) => $['members.transferModal.transfer'], { ns: 'workspaceMembers' })}
            </Button>
            <DialogClose render={<Button />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
          </DialogFooter>
        </>
      )}
    </>
  )
}
export default TransferOwnershipContent
