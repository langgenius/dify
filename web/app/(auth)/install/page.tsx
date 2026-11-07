import { redirect } from '@/next/navigation'
import { consoleClient } from '@/service/console'
import { resolveServerConsoleApiPrefix } from '@/service/console/server'
import InstallForm from './installForm'

export default async function Install() {
  if (resolveServerConsoleApiPrefix()) {
    const setup = await consoleClient.setup.get()
    if (setup.step === 'finished') redirect('/signin')
  }

  return <InstallForm />
}
