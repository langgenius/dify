import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
// import { useAppContext } from '@/context/app-context'
// import Button from '@/app/components/base/button'
// import Toast from '@/app/components/base/toast'
// import Indicator from '@/app/components/header/indicator'
// import ToolItem from '@/app/components/tools/provider/tool-item'
// import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import type { PluginDetail } from '@/app/components/plugins/types'
import { useDataSourceList } from '@/service/use-pipeline'
import { transformDataSourceToTool } from '@/app/components/workflow/block-selector/utils'

type Props = {
  detail: PluginDetail
}

const ActionList = ({
  detail,
}: Props) => {
  const { t } = useTranslation()
  // const { isCurrentWorkspaceManager } = useAppContext()
  // const providerBriefInfo = detail.declaration.datasource?.identity
  // const providerKey = `${detail.plugin_id}/${providerBriefInfo?.name}`
  const { data: dataSourceList } = useDataSourceList(true)
  const provider = useMemo(() => {
    const result = dataSourceList?.find(collection => collection.plugin_id === detail.plugin_id)

    if (result)
      return transformDataSourceToTool(result)
  }, [detail.plugin_id, dataSourceList])
  const data: any = []
  // const { data } = useBuiltinTools(providerKey)

  // const [showSettingAuth, setShowSettingAuth] = useState(false)

  // const handleCredentialSettingUpdate = () => {
  //   Toast.notify({
  //     type: 'success',
  //     message: t('common.api.actionSuccess'),
  //   })
  //   setShowSettingAuth(false)
  // }

  // const { mutate: updatePermission, isPending } = useUpdateProviderCredentials({
  //   onSuccess: handleCredentialSettingUpdate,
  // })

  // const { mutate: removePermission } = useRemoveProviderCredentials({
  //   onSuccess: handleCredentialSettingUpdate,
  // })

  if (!data || !provider)
    return null

  return (
    <div className='px-4 pb-4 pt-2'>
      <div className='mb-1 py-1'>
        <div className='system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between text-text-secondary'>
          {t('plugin.detailPanel.actionNum', { num: data.length, action: data.length > 1 ? 'actions' : 'action' })}
          {/* {provider.is_team_authorization && provider.allow_delete && (
            <Button
              variant='secondary'
              size='small'
              onClick={() => setShowSettingAuth(true)}
              disabled={!isCurrentWorkspaceManager}
            >
              <Indicator className='mr-2' color={'green'} />
              {t('tools.auth.authorized')}
            </Button>
          )} */}
        </div>
        {/* {!provider.is_team_authorization && provider.allow_delete && (
          <Button
            variant='primary'
            className='w-full'
            onClick={() => setShowSettingAuth(true)}
            disabled={!isCurrentWorkspaceManager}
          >{t('workflow.nodes.tool.authorize')}</Button>
        )} */}
      </div>
      {/* <div className='flex flex-col gap-2'>
        {data.map(tool => (
          <ToolItem
            key={`${detail.plugin_id}${tool.name}`}
            disabled={false}
            collection={provider}
            tool={tool}
            isBuiltIn={true}
            isModel={false}
          />
        ))}
      </div>
      {showSettingAuth && (
        <ConfigCredential
          collection={provider}
          onCancel={() => setShowSettingAuth(false)}
          onSaved={async value => updatePermission({
            providerName: provider.name,
            credentials: value,
          })}
          onRemove={async () => removePermission(provider.name)}
          isSaving={isPending}
        />
      )} */}
    </div>
  )
}

export default ActionList
