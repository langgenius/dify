import { redirect } from '@/next/navigation'

type ForgotPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// Legacy route: password recovery now runs through the email-code flow at `/reset-password`.
export default async function ForgotPassword({ searchParams }: ForgotPasswordPageProps) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value].flat()) {
      if (item !== undefined) params.append(key, item)
    }
  }
  const query = params.toString()
  redirect(query ? `/reset-password?${query}` : '/reset-password')
}
