import type { EmailConfig } from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { RiBugLine } from '@remixicon/react'
import { memo, useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import MailBodyInput from './mail-body-input'
import Recipient from './recipient'

const i18nPrefix = 'nodes.humanInput'

type EmailConfigureModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (data: EmailConfig) => void
  config?: EmailConfig
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

const EmailConfigureModal = ({
  open,
  onOpenChange,
  onConfirm,
  config,
  nodesOutputVars = [],
  availableNodes = [],
}: EmailConfigureModalProps) => {
  const { t } = useTranslation()
  const email = useAppContextWithSelector(s => s.userProfile.email)
  const [recipients, setRecipients] = useState(config?.recipients || { whole_workspace: false, items: [] })
  const [subject, setSubject] = useState(config?.subject || '')
  const [body, setBody] = useState(config?.body || '{{#url#}}')
  const [debugMode, setDebugMode] = useState(config?.debug_mode || false)

  const checkValidConfig = useCallback(() => {
    if (!subject.trim()) {
      toast.error(t(`${i18nPrefix}.deliveryMethod.emailConfigure.subjectRequired`, { ns: 'workflow' }))
      return false
    }
    if (!body.trim()) {
      toast.error(t(`${i18nPrefix}.deliveryMethod.emailConfigure.bodyRequired`, { ns: 'workflow' }))
      return false
    }
    if (!/\{\{#url#\}\}/.test(body.trim())) {
      toast.error(t(`${i18nPrefix}.deliveryMethod.emailConfigure.bodyMustContainRequestURL`, {
        ns: 'workflow',
        field: t('promptEditor.requestURL.item.title', { ns: 'common' }),
      }))
      return false
    }
    if (!recipients || (recipients.items.length === 0 && !recipients.whole_workspace)) {
      toast.error(t(`${i18nPrefix}.deliveryMethod.emailConfigure.recipientsRequired`, { ns: 'workflow' }))
      return false
    }
    return true
  }, [recipients, subject, body, t])

  const handleConfirm = useCallback(() => {
    if (!checkValidConfig())
      return
    onConfirm({
      recipients,
      subject,
      body,
      debug_mode: debugMode,
    })
  }, [checkValidConfig, onConfirm, recipients, subject, body, debugMode])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[calc(100dvh-64px)]! w-[720px]!">
        <DialogCloseButton />
        <div className="space-y-1 pr-8">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.title`, { ns: 'workflow' })}</DialogTitle>
          <div className="system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.description`, { ns: 'workflow' })}</div>
        </div>
        <div className="mt-6 space-y-5">
          <div>
            <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
              {t(`${i18nPrefix}.deliveryMethod.emailConfigure.subject`, { ns: 'workflow' })}
            </div>
            <Input
              className="w-full"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={t(`${i18nPrefix}.deliveryMethod.emailConfigure.subjectPlaceholder`, { ns: 'workflow' })}
            />
          </div>
          <div>
            <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
              {t(`${i18nPrefix}.deliveryMethod.emailConfigure.body`, { ns: 'workflow' })}
            </div>
            <MailBodyInput
              value={body}
              onChange={setBody}
              nodesOutputVars={nodesOutputVars}
              availableNodes={availableNodes}
            />
          </div>
          <div>
            <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">
              {t(`${i18nPrefix}.deliveryMethod.emailConfigure.recipient`, { ns: 'workflow' })}
            </div>
            <Recipient
              data={recipients}
              onChange={setRecipients}
            />
          </div>
          <div className="flex items-start justify-between gap-2 rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-3 pl-2.5 shadow-xs">
            <div className="rounded-sm border border-divider-regular bg-components-icon-bg-orange-dark-solid p-0.5">
              <RiBugLine className="h-3.5 w-3.5 text-text-primary-on-surface" />
            </div>
            <div className="grow space-y-1">
              <div className="system-sm-medium text-text-secondary">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.debugMode`, { ns: 'workflow' })}</div>
              <div className="body-xs-regular text-text-tertiary">
                <Trans
                  i18nKey={`${i18nPrefix}.deliveryMethod.emailConfigure.debugModeTip1`}
                  ns="workflow"
                  components={{ email: <span className="body-md-medium text-text-primary">{email}</span> }}
                  values={{ email }}
                />
                <div>{t(`${i18nPrefix}.deliveryMethod.emailConfigure.debugModeTip2`, { ns: 'workflow' })}</div>
              </div>
            </div>
            <Switch
              checked={debugMode}
              onCheckedChange={checked => setDebugMode(checked)}
            />
          </div>
        </div>
        <div className="mt-6 flex flex-row-reverse gap-2">
          <Button
            variant="primary"
            className="w-[72px]"
            onClick={handleConfirm}
          >
            {t('operation.save', { ns: 'common' })}
          </Button>
          <Button
            className="w-[72px]"
            onClick={() => onOpenChange(false)}
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(EmailConfigureModal)
