'use client'
import { useCallback } from 'react'
import MailForm from './components/input-mail'
import { useRouter, useSearchParams } from 'next/navigation'

const Signup = () => {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleInputMailSubmitted = useCallback((email: string, result: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('token', encodeURIComponent(result))
    params.set('email', encodeURIComponent(email))
    router.push(`/signup/check-code?${params.toString()}`)
  }, [router, searchParams])

  return (
    <div className="mx-auto mt-8 w-full">
      <MailForm onSuccess={handleInputMailSubmitted} />
    </div>
  )
}

export default Signup
