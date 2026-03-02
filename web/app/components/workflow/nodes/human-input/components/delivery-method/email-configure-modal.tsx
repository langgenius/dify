import type { EmailConfig } from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { RiBugLine, RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/compat'
import { memo, useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import MailBodyInput from './mail-body-input'
import Recipient from './recipient'

const i18nPrefix = 'nodes.humanInput'

type EmailConfigureModalProps = {
  isShow: boolean
  onClose: () => void
  onConfirm: (data: EmailConfig) => void
  config?: EmailConfig
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

const EmailConfigureModal = ({
  isShow,
  onClose,
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
      Toast.notify({
        type: 'error',
        message: 'subject is required',
      })
      return false
    }
    if (!body.trim()) {
      Toast.notify({
        type: 'error',
        message: 'body is required',
      })
      return false
    }
    if (!/\{\{#url#\}\}/.test(body.trim())) {
      Toast.notify({
        type: 'error',
        message: `body must contain one ${t('promptEditor.requestURL.item.title', { ns: 'common' })}`,
      })
      return false
    }
    if (!recipients || (recipients.items.length === 0 && !recipients.whole_workspace)) {
      Toast.notify({
        type: 'error',
        message: 'recipients is required',
      })
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
    <Modal
      isShow={isShow}
      onClose={noop}
      className="relative !max-w-[720px] !p-0"
    >
      <div className="absolute right-5 top-5 cursor-pointer p-1.5" onClick={onClose}>
        <RiCloseLine className="h-5 w-5 text-text-tertiary" />
      </div>
      <div className="space-y-1 p-6 pb-3">
        <div className="title-2xl-semi-bold text-text-primary">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.title`, { ns: 'workflow' })}</div>
        <div className="system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.description`, { ns: 'workflow' })}</div>
      </div>
      <div className="space-y-5 px-6 py-3">
        <div>
          <div className="system-sm-medium mb-1 flex h-6 items-center text-text-secondary">
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
          <div className="system-sm-medium mb-1 flex h-6 items-center text-text-secondary">
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
          <div className="system-sm-medium mb-1 flex h-6 items-center text-text-secondary">
            {t(`${i18nPrefix}.deliveryMethod.emailConfigure.recipient`, { ns: 'workflow' })}
          </div>
          <Recipient
            data={recipients}
            onChange={setRecipients}
          />
        </div>
        <Divider className="!my-0 !mt-5 !h-px" />
        <div className="flex items-start justify-between gap-2 rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-3 pl-2.5 shadow-xs">
          <div className="rounded-[4px] border border-divider-regular bg-components-icon-bg-orange-dark-solid p-0.5">
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
            value={debugMode}
            onChange={checked => setDebugMode(checked)}
          />
        </div>
      </div>
      <div className="flex flex-row-reverse gap-2 p-6 pt-5">
        <Button
          variant="primary"
          className="w-[72px]"
          onClick={handleConfirm}
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
        <Button
          className="w-[72px]"
          onClick={onClose}
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
      </div>
    </Modal>
  )
}

export default memo(EmailConfigureModal)
