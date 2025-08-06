import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Input from '@/app/components/base/input'
import TextArea from '@/app/components/base/textarea'
import Button from '@/app/components/base/button'
import { noop } from 'lodash-es'

const i18nPrefix = 'workflow.nodes.humanInput'

type Recipient = {
  value: string
  label: string
}

type EmailConfigureModalProps = {
  isShow: boolean
  onClose: () => void
  onConfirm: (data: any) => void
}

const EmailConfigureModal = ({
  isShow,
  onClose,
  onConfirm,
}: EmailConfigureModalProps) => {
  const { t } = useTranslation()

  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const handleConfirm = useCallback(() => {
    onConfirm({
      recipients: recipients.map(recipient => recipient.value),
      subject,
      body,
    })
  }, [recipients, subject, body, onConfirm])

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
          <TextArea
            className="min-h-[200px] w-full"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={t('email.configure.enterBody', 'Enter email content')}
          />
        </div>
      </div>
      <div className='flex flex-row-reverse gap-2 p-6 pt-5'>
        <Button
          variant='primary'
          className='w-[72px]'
          onClick={onClose}
        >
          {t('common.operation.save')}
        </Button>
        <Button
          className='w-[72px]'
          onClick={handleConfirm}
        >
          {t('common.operation.cancel')}
        </Button>
      </div>
    </Modal>
  )
}

export default memo(EmailConfigureModal)
