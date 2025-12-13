import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import Item from './item'
import Empty from './empty'
import Button from '@/app/components/base/button'
import { useModalContext } from '@/context/modal-context'
import { useApiBasedExtensions } from '@/service/use-common'

const ApiBasedExtensionPage = () => {
  const { t } = useTranslation()
  const { setShowApiBasedExtensionModal } = useModalContext()
  const { data, refetch: mutate, isPending: isLoading } = useApiBasedExtensions()

  const handleOpenApiBasedExtensionModal = () => {
    setShowApiBasedExtensionModal({
      payload: {},
      onSaveCallback: () => mutate(),
    })
  }

  return (
    <div>
      {
        !isLoading && !data?.length && (
          <Empty />
        )
      }
      {
        !isLoading && !!data?.length && (
          data.map(item => (
            <Item
              key={item.id}
              data={item}
              onUpdate={() => mutate()}
            />
          ))
        )
      }
      <Button
        variant='secondary'
        className='w-full'
        onClick={handleOpenApiBasedExtensionModal}
      >
        <RiAddLine className='mr-1 h-4 w-4' />
        {t('common.apiBasedExtension.add')}
      </Button>
    </div>
  )
}

export default ApiBasedExtensionPage
