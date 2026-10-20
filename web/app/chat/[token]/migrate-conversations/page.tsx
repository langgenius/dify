import SignInConfirmation from '@/app/components/share/signin-confirmation'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $['history.title'])
}

export default function MigrateConversationsPage() {
  // Preview data until the post-sign-in conversation ownership API is available.
  return (
    <SignInConfirmation
      email="evan@dify.ai"
      conversationCount={3}
      app={{
        title: 'Writing Assistant',
        description: 'Draft, rewrite, and summarize text. No external services required.',
      }}
      iconFallback={{
        content: <span aria-hidden="true" className="i-ri-asterisk size-6 text-white" />,
        background: '#FF4405',
      }}
    />
  )
}
