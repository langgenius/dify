import type { useDifyBuilderModel } from './use-dify-builder-model'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'

type ModelStatusProps = Pick<
  ReturnType<typeof useDifyBuilderModel>,
  'isLoading' | 'isError' | 'hasAvailableModels' | 'retry'
> & {
  id: string
  rejected: boolean
}

export const DifyBuilderModelStatus = ({
  id,
  isLoading,
  isError,
  hasAvailableModels,
  retry,
  rejected,
}: ModelStatusProps) => {
  const { t } = useTranslation()
  const permissions = useAtomValue(workspacePermissionKeysAtom)
  const canConfigure = hasPermission(permissions, 'plugin.model_config')
  const [_settings, setSettings] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const message = isLoading
    ? t(($) => $['difyBuilder.modelLoading'], { ns: 'workflow' })
    : isError
      ? t(($) => $['difyBuilder.modelLoadFailed'], { ns: 'workflow' })
      : rejected
        ? t(($) => $['difyBuilder.modelUnavailable'], { ns: 'workflow' })
        : hasAvailableModels
          ? t(($) => $['workflowGenerator.modelRequired'], { ns: 'workflow' })
          : canConfigure
            ? t(($) => $['modelProvider.noneConfigured'], { ns: 'common' })
            : t(($) => $['difyBuilder.modelContactAdmin'], { ns: 'workflow' })

  return (
    <div className="mx-4 mb-2 flex flex-col gap-2 rounded-lg bg-state-warning-hover p-2 text-text-secondary">
      <p id={id} role={isError || rejected ? 'alert' : 'status'} className="system-xs-regular">
        {message}
      </p>
      {!isLoading && (
        <div className="flex gap-2">
          {(isError || rejected) && (
            <Button size="small" onClick={() => void retry()}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          )}
          {!isError && canConfigure && (!hasAvailableModels || rejected) && (
            <Button size="small" onClick={() => void setSettings('provider')}>
              {t(($) => $['errorMsg.configureModel'], { ns: 'workflow' })}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
