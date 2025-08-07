import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import Recipient from './recipient'
import MailBodyInput from './mail-body-input'
import Toast from '@/app/components/base/toast'
import type { EmailConfig } from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { noop } from 'lodash-es'

const i18nPrefix = 'workflow.nodes.humanInput'

type EmailConfigureModalProps = {
  isShow: boolean
  onClose: () => void
  onConfirm: (data: any) => void
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

  const [recipients, setRecipients] = useState(config?.recipients || { whole_workspace: false, items: [] })
  const [subject, setSubject] = useState(config?.subject || '')
  const [body, setBody] = useState(config?.body || '')

  const checkValidConfig = () => {
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
    if (!recipients || (recipients.items.length === 0 && !recipients.whole_workspace)) {
      Toast.notify({
        type: 'error',
        message: 'recipients is required',
      })
      return false
    }
    return true
  }

  const handleConfirm = useCallback(() => {
    if (!checkValidConfig()) return
    onConfirm({
      recipients,
      subject,
      body,
    })
  }, [subject, body, onConfirm])

  return (
    <Modal
      isShow={isShow}
      onClose={noop}
      className='relative !max-w-[720px] !p-0'
    >
      <div className='absolute right-5 top-5 cursor-pointer p-1.5' onClick={onClose}>
        <RiCloseLine className='h-5 w-5 text-text-tertiary' />
      </div>
      <div className='space-y-1 p-6 pb-3'>
        <div className='title-2xl-semi-bold text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.emailConfigure.title`)}</div>
        <div className='system-xs-regular text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.emailConfigure.description`)}</div>
      </div>
      <div className='space-y-5 px-6 py-3'>
        <div>
          <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>
            {t(`${i18nPrefix}.deliveryMethod.emailConfigure.recipient`)}
          </div>
          <Recipient
            data={recipients}
            onChange={setRecipients}
          />
        </div>
        <div>
          <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>
            {t(`${i18nPrefix}.deliveryMethod.emailConfigure.subject`)}
          </div>
          <Input
            className='w-full'
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t(`${i18nPrefix}.deliveryMethod.emailConfigure.subjectPlaceholder`)}
          />
        </div>
        <div>
          <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>
            {t(`${i18nPrefix}.deliveryMethod.emailConfigure.body`)}
          </div>
          <MailBodyInput
            value={body}
            onChange={setBody}
            nodesOutputVars={nodesOutputVars}
            availableNodes={availableNodes}
          />
        </div>
      </div>
      <div className='flex flex-row-reverse gap-2 p-6 pt-5'>
        <Button
          variant='primary'
          className='w-[72px]'
          onClick={handleConfirm}
        >
          {t('common.operation.save')}
        </Button>
        <Button
          className='w-[72px]'
          onClick={onClose}
        >
          {t('common.operation.cancel')}
        </Button>
      </div>
    </Modal>
  )
}

export default memo(EmailConfigureModal)
