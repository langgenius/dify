import { CommonLayoutHydrationBoundary } from '@/app/(commonLayout)/hydration-boundary'
import ConsoleHumanInputForm from '@/features/console-human-input-form/form'

export default async function Page({ params }: { params: Promise<{ formToken: string }> }) {
  const { formToken } = await params

  return (
    <CommonLayoutHydrationBoundary>
      <main className="h-full min-w-75 bg-chatbot-bg pb-[env(safe-area-inset-bottom)]">
        <ConsoleHumanInputForm key={formToken} formToken={formToken} />
      </main>
    </CommonLayoutHydrationBoundary>
  )
}
