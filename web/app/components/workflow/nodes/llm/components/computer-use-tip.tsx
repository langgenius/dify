import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type Props = {
  visible: boolean
  onEnable: () => void
}

const ComputerUseTip: FC<Props> = ({
  visible,
  onEnable,
}) => {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = React.useState(false)

  React.useEffect(() => {
    if (!visible)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setDismissed(false)
  }, [visible])

  if (!visible || dismissed)
    return null

  return (
    <div className="relative top-1 rounded-xl border border-state-warning-hover-alt bg-state-warning-hover pb-2 pl-2.5 pr-2 pt-2.5">
      <div className="flex items-start gap-1.5">
        <span className="i-ri-alert-fill mt-0.5 size-4 shrink-0 text-text-warning-secondary" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="text-text-primary system-sm-regular">
            {t('nodes.llm.computerUse.enableForPromptTools', { ns: 'workflow' })}
          </div>
          <div className="flex items-center justify-end gap-1">
            <Button
              size="small"
              onClick={() => setDismissed(true)}
            >
              {t('nodes.llm.computerUse.dismiss', { ns: 'workflow' })}
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={onEnable}
            >
              {t('nodes.llm.computerUse.enable', { ns: 'workflow' })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(ComputerUseTip)
