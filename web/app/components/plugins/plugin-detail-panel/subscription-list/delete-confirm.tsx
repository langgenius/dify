import Confirm from '@/app/components/base/confirm'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { useDeleteTriggerSubscription } from '@/service/use-triggers'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginSubscriptionStore } from './store'

type Props = {
  onClose: (deleted: boolean) => void
  isShow: boolean
  currentId: string
  currentName: string
  workflowsInUse: number
}

const tPrefix = 'pluginTrigger.subscription.list.item.actions.deleteConfirm'

export const DeleteConfirm = (props: Props) => {
  const { onClose, isShow, currentId, currentName, workflowsInUse } = props
  const { refresh } = usePluginSubscriptionStore()
  const { mutate: deleteSubscription, isPending: isDeleting } = useDeleteTriggerSubscription()
  const { t } = useTranslation()
  const [inputName, setInputName] = useState('')

  const onConfirm = () => {
    if (workflowsInUse > 0 && inputName !== currentName) {
      Toast.notify({
        type: 'error',
        message: t(`${tPrefix}.confirmInputWarning`),
        // temporarily
        className: 'z-[10000001]',
      })
      return
    }
    deleteSubscription(currentId, {
      onSuccess: () => {
        Toast.notify({
          type: 'success',
          message: t(`${tPrefix}.success`, { name: currentName }),
          className: 'z-[10000001]',
        })
        refresh?.()
        onClose(true)
      },
      onError: (error: any) => {
        Toast.notify({
          type: 'error',
          message: error?.message || t(`${tPrefix}.error`, { name: currentName }),
          className: 'z-[10000001]',
        })
      },
    })
  }
  return <Confirm
    title={t(`${tPrefix}.title`, { name: currentName })}
    confirmText={t(`${tPrefix}.confirm`)}
    content={workflowsInUse > 0 ? <>
      {t(`${tPrefix}.contentWithApps`, { count: workflowsInUse })}
      <div className='system-sm-medium mb-2 mt-6 text-text-secondary'>{t(`${tPrefix}.confirmInputTip`, { name: currentName })}</div>
      <Input
        value={inputName}
        onChange={e => setInputName(e.target.value)}
        placeholder={t(`${tPrefix}.confirmInputPlaceholder`, { name: currentName })}
      />
    </>
      : t(`${tPrefix}.content`)}
    isShow={isShow}
    isLoading={isDeleting}
    isDisabled={isDeleting}
    onConfirm={onConfirm}
    onCancel={() => onClose(false)}
    maskClosable={false}
  />
}
