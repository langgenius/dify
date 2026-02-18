import type { PluginProvider } from '@/models/common'
import { LockClosedIcon } from '@heroicons/react/24/solid'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { usePluginProviders } from '@/service/use-common'
import SerpapiPlugin from './SerpapiPlugin'

const PluginPage = () => {
  const { t } = useTranslation()
  const { data: plugins, refetch: mutate } = usePluginProviders()

  const Plugin_MAP: Record<string, (plugin: PluginProvider) => React.JSX.Element> = {
    serpapi: (plugin: PluginProvider) => <SerpapiPlugin key="serpapi" plugin={plugin} onUpdate={() => mutate()} />,
  }

  return (
    <div className="pb-7">
      <div>
        {plugins?.map(plugin => Plugin_MAP[plugin.tool_name](plugin))}
      </div>
      <div className="fixed bottom-0 flex h-[42px] w-[472px] items-center bg-white text-xs text-gray-500">
        <LockClosedIcon className="mr-1 h-3 w-3" />
        {t('provider.encrypted.front', { ns: 'common' })}
        <Link
          className="mx-1 text-primary-600"
          target="_blank"
          rel="noopener noreferrer"
          href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html"
        >
          PKCS1_OAEP
        </Link>
        {t('provider.encrypted.back', { ns: 'common' })}
      </div>
    </div>
  )
}

export default PluginPage
