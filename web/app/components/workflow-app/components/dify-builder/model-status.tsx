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
import { useDifyBuilderInteractionLocale } from './interactions/use-interaction-locale'

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
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], {
    lng: locale,
  })
  const permissions = useAtomValue(workspacePermissionKeysAtom)
  const canConfigure = hasPermission(permissions, 'plugin.model_config')
  const [_settings, setSettings] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const message = isLoading
    ? t(($) => $.modelLoading, { ns: 'difyBuilder' })
    : isError
      ? t(($) => $.modelLoadFailed, { ns: 'difyBuilder' })
      : rejected
        ? t(($) => $.modelUnavailable, { ns: 'difyBuilder' })
        : hasAvailableModels
          ? t(($) => $.modelRequired, { ns: 'difyBuilder' })
          : canConfigure
            ? t(($) => $.modelNoneConfigured, { ns: 'difyBuilder' })
            : t(($) => $.modelContactAdmin, { ns: 'difyBuilder' })

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
              {t(($) => $.configureModel, { ns: 'difyBuilder' })}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
