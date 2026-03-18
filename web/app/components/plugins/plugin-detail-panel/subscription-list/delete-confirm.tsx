import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import Input from '@/app/components/base/input'
import { toast } from '@/app/components/base/ui/toast'
import { useDeleteTriggerSubscription } from '@/service/use-triggers'
import { useSubscriptionList } from './use-subscription-list'

type Props = {
  onClose: (deleted: boolean) => void
  isShow: boolean
  currentId: string
  currentName: string
  workflowsInUse: number
}

const tPrefix = 'subscription.list.item.actions.deleteConfirm'

export const DeleteConfirm = (props: Props) => {
  const { onClose, isShow, currentId, currentName, workflowsInUse } = props
  const { refetch } = useSubscriptionList()
  const { mutate: deleteSubscription, isPending: isDeleting } = useDeleteTriggerSubscription()
  const { t } = useTranslation()
  const [inputName, setInputName] = useState('')

  const onConfirm = () => {
    if (workflowsInUse > 0 && inputName !== currentName) {
      toast.add({
        type: 'error',
        title: t(`${tPrefix}.confirmInputWarning`, { ns: 'pluginTrigger' }),
      })
      return
    }
    deleteSubscription(currentId, {
      onSuccess: () => {
        toast.add({
          type: 'success',
          title: t(`${tPrefix}.success`, { ns: 'pluginTrigger', name: currentName }),
        })
        refetch?.()
        onClose(true)
      },
      onError: (error: any) => {
        toast.add({
          type: 'error',
          title: error?.message || t(`${tPrefix}.error`, { ns: 'pluginTrigger', name: currentName }),
        })
      },
    })
  }
  return (
    <Confirm
      title={t(`${tPrefix}.title`, { ns: 'pluginTrigger', name: currentName })}
      confirmText={t(`${tPrefix}.confirm`, { ns: 'pluginTrigger' })}
      content={workflowsInUse > 0
        ? (
            <>
              {t(`${tPrefix}.contentWithApps`, { ns: 'pluginTrigger', count: workflowsInUse })}
              <div className="mb-2 mt-6 text-text-secondary system-sm-medium">{t(`${tPrefix}.confirmInputTip`, { ns: 'pluginTrigger', name: currentName })}</div>
              <Input
                value={inputName}
                onChange={e => setInputName(e.target.value)}
                placeholder={t(`${tPrefix}.confirmInputPlaceholder`, { ns: 'pluginTrigger', name: currentName })}
              />
            </>
          )
        : t(`${tPrefix}.content`, { ns: 'pluginTrigger' })}
      isShow={isShow}
      isLoading={isDeleting}
      isDisabled={isDeleting}
      onConfirm={onConfirm}
      onCancel={() => onClose(false)}
      maskClosable={false}
    />
  )
}
