import Confirm from '@/app/components/base/confirm'
import { usePluginSubscriptionStore } from './store'
import { useDeleteTriggerSubscription } from '@/service/use-triggers'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'

type Props = {
  onClose: (deleted: boolean) => void
  isShow: boolean
  currentId: string
  currentName: string
}

export const DeleteConfirm = (props: Props) => {
  const { onClose, isShow, currentId, currentName } = props
  const { refresh } = usePluginSubscriptionStore()
  const { mutate: deleteSubscription, isPending: isDeleting } = useDeleteTriggerSubscription()
  const { t } = useTranslation()

  const onConfirm = () => {
    deleteSubscription(currentId, {
      onSuccess: () => {
        Toast.notify({
          type: 'success',
          message: t('pluginTrigger.subscription.list.item.actions.deleteConfirm.title'),
        })
        refresh?.()
        onClose(true)
      },
      onError: (error: any) => {
        Toast.notify({
          type: 'error',
          message: error?.message || 'Failed to delete subscription',
        })
      },
    })
  }
  return <Confirm
    title={t('pluginTrigger.subscription.list.item.actions.deleteConfirm.title')}
    content={t('pluginTrigger.subscription.list.item.actions.deleteConfirm.content', { name: currentName })}
    isShow={isShow}
    isLoading={isDeleting}
    onConfirm={onConfirm}
    onCancel={() => onClose(false)}
  />
}
