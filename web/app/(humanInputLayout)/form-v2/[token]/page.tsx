import { ENABLE_HITL_IM } from '@/config'
import { notFound } from '@/next/navigation'
import FormContent from './form'

const FormPage = () => {
  if (!ENABLE_HITL_IM) notFound()
  return (
    <div className="h-full min-w-75 bg-chatbot-bg pb-[env(safe-area-inset-bottom)]">
      <FormContent />
    </div>
  )
}

export default FormPage
