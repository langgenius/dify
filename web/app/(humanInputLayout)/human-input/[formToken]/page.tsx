import { CommonLayoutHydrationBoundary } from '@/app/(commonLayout)/hydration-boundary'
import { ENABLE_HITL_IM } from '@/config'
import ConsoleHumanInputForm from '@/features/human-input/console/form'
import { notFound } from '@/next/navigation'

export default async function Page({ params }: { params: Promise<{ formToken: string }> }) {
  if (!ENABLE_HITL_IM) notFound()
  const { formToken } = await params

  return (
    <CommonLayoutHydrationBoundary>
      <main className="h-full min-w-75 bg-chatbot-bg pb-[env(safe-area-inset-bottom)]">
        <ConsoleHumanInputForm key={formToken} formToken={formToken} />
      </main>
    </CommonLayoutHydrationBoundary>
  )
}
