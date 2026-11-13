import ChangePasswordForm from './ChangePasswordForm'
import ForgotPasswordForm from './ForgotPasswordForm'

type ForgotPasswordPageProps = {
  searchParams: Promise<{ token?: string | string[] }>
}

export default async function ForgotPassword({ searchParams }: ForgotPasswordPageProps) {
  const { token } = await searchParams
  return token ? <ChangePasswordForm /> : <ForgotPasswordForm />
}
