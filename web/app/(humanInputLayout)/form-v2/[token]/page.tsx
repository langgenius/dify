import { ENABLE_HITL_IM } from '@/config'
import { notFound } from '@/next/navigation'
import FormContent from './form'

const FormPage = () => {
  if (!ENABLE_HITL_IM) notFound()
  return (
    <main className="h-dvh min-w-75 bg-chatbot-bg pb-[env(safe-area-inset-bottom)]">
      <FormContent />
    </main>
  )
}

export default FormPage
