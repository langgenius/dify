import { useTranslation } from 'react-i18next'
import HumanInputForm from './human-input-form'
import type { FormData } from './human-input-form'
import { useChatContext } from '../../context'
import type { HumanInputFormData } from '@/types/workflow'
import type { DeliveryMethod } from '@/app/components/workflow/nodes/human-input/types'
import { DeliveryMethodType } from '@/app/components/workflow/nodes/human-input/types'
import Divider from '@/app/components/base/divider'

type Props = {
  formData: HumanInputFormData
  showTimeout?: boolean
  onSubmit?: (formID: string, data: any) => void
}

const HumanInputContent = ({ formData, onSubmit }: Props) => {
  const { t } = useTranslation()
  const {
    getHumanInputNodeData,
  } = useChatContext()

  const deliveryMethodsConfig = getHumanInputNodeData?.(formData.node_id as any)?.data.delivery_methods || []
  const isWebappEnabled = deliveryMethodsConfig.some((method: DeliveryMethod) => method.type === DeliveryMethodType.WebApp && method.enabled)
  const isEmailEnabled = deliveryMethodsConfig.some((method: DeliveryMethod) => method.type === DeliveryMethodType.Email && method.enabled)

  return (
    <>
      <HumanInputForm
        formData={formData as any as FormData}
        onSubmit={onSubmit}
      />
      {(!isWebappEnabled || isEmailEnabled) && (
        <>
          <Divider className='!my-2 w-[30px]' />
          <div className='space-y-1 pt-1'>
            {isEmailEnabled && <div className='system-xs-regular text-text-secondary'>{t('humanInputEmailTip')}</div>}
            {!isWebappEnabled && <div className='system-xs-medium text-text-warning'>{t('humanInputWebappTip')}</div>}
          </div>
        </>
      )}
    </>
  )
}

export default HumanInputContent
