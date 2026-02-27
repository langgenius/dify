import type { FC } from 'react'
import type { ApiBasedExtension } from '@/models/common'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import { useDocLink } from '@/context/i18n'
import {
  addApiBasedExtension,
  updateApiBasedExtension,
} from '@/service/common'

export type ApiBasedExtensionData = {
  name?: string
  apiEndpoint?: string
  apiKey?: string
}

type ApiBasedExtensionModalProps = {
  data: ApiBasedExtension
  onCancel: () => void
  onSave?: (newData: ApiBasedExtension) => void
}
const ApiBasedExtensionModal: FC<ApiBasedExtensionModalProps> = ({
  data,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const [localeData, setLocaleData] = useState(data)
  const [loading, setLoading] = useState(false)
  const { notify } = useToastContext()
  const handleDataChange = (type: string, value: string) => {
    setLocaleData({ ...localeData, [type]: value })
  }
  const handleSave = async () => {
    setLoading(true)

    if (localeData && localeData.api_key && localeData.api_key?.length < 5) {
      notify({ type: 'error', message: t('apiBasedExtension.modal.apiKey.lengthError', { ns: 'common' }) })
      setLoading(false)
      return
    }

    try {
      let res: ApiBasedExtension = {}
      if (!data.id) {
        res = await addApiBasedExtension({
          url: '/api-based-extension',
          body: localeData,
        })
      }
      else {
        res = await updateApiBasedExtension({
          url: `/api-based-extension/${data.id}`,
          body: {
            ...localeData,
            api_key: data.api_key === localeData.api_key ? '[__HIDDEN__]' : localeData.api_key,
          },
        })

        notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      }

      if (onSave)
        onSave(res)
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isShow
      onClose={noop}
      className="!w-[640px] !max-w-none !p-8 !pb-6"
    >
      <div className="mb-2 text-xl font-semibold text-text-primary">
        {
          data.name
            ? t('apiBasedExtension.modal.editTitle', { ns: 'common' })
            : t('apiBasedExtension.modal.title', { ns: 'common' })
        }
      </div>
      <div className="py-2">
        <div className="text-sm font-medium leading-9 text-text-primary">
          {t('apiBasedExtension.modal.name.title', { ns: 'common' })}
        </div>
        <input
          value={localeData.name || ''}
          onChange={e => handleDataChange('name', e.target.value)}
          className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-none"
          placeholder={t('apiBasedExtension.modal.name.placeholder', { ns: 'common' }) || ''}
        />
      </div>
      <div className="py-2">
        <div className="flex h-9 items-center justify-between text-sm font-medium text-text-primary">
          {t('apiBasedExtension.modal.apiEndpoint.title', { ns: 'common' })}
          <a
            href={docLink('/use-dify/workspace/api-extension/api-extension')}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center text-xs font-normal text-text-accent"
          >
            <BookOpen01 className="mr-1 h-3 w-3" />
            {t('apiBasedExtension.link', { ns: 'common' })}
          </a>
        </div>
        <input
          value={localeData.api_endpoint || ''}
          onChange={e => handleDataChange('api_endpoint', e.target.value)}
          className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-none"
          placeholder={t('apiBasedExtension.modal.apiEndpoint.placeholder', { ns: 'common' }) || ''}
        />
      </div>
      <div className="py-2">
        <div className="text-sm font-medium leading-9 text-text-primary">
          {t('apiBasedExtension.modal.apiKey.title', { ns: 'common' })}
        </div>
        <div className="flex items-center">
          <input
            value={localeData.api_key || ''}
            onChange={e => handleDataChange('api_key', e.target.value)}
            className="mr-2 block h-9 grow appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-none"
            placeholder={t('apiBasedExtension.modal.apiKey.placeholder', { ns: 'common' }) || ''}
          />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-end">
        <Button
          onClick={onCancel}
          className="mr-2"
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          variant="primary"
          disabled={!localeData.name || !localeData.api_endpoint || !localeData.api_key || loading}
          onClick={handleSave}
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </Modal>
  )
}

export default ApiBasedExtensionModal
