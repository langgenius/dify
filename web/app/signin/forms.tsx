import SSOAuthButton from './components/sso-auth'
import NormalForm from './normalForm'
import { API_PREFIX } from '@/config'
// !WARNING this file is not used by others
export default function RenderFormBySystemFeatures() {
  async function getFeatures() {
    'use server'
    const ret = await fetch(`${API_PREFIX}/system-features`).then((ret) => {
      return ret.json()
    })
    return ret
  }
  const systemFeatures = await getFeatures()
  if (systemFeatures.isSsoEnabled)
    return <SSOAuthButton />
  return <NormalForm />
}
