import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import type { AgentRosterNodeData } from '@/app/components/workflow/block-selector/types'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { useTranslation } from 'react-i18next'
import OutputVars, { VarItem } from '../_base/components/output-vars'

const i18nPrefix = 'nodes.agent'

function AgentRosterAvatar({
  agent,
}: {
  agent: AgentRosterNodeData
}) {
  const imageUrl = (agent.icon_type === 'image' || agent.icon_type === 'link') ? agent.icon : undefined

  return (
    <AvatarRoot
      size="lg"
      className="border-[0.5px] border-divider-regular text-xl"
      style={{ background: imageUrl ? undefined : (agent.icon_background || '#FFEAD5') }}
    >
      {imageUrl && (
        <AvatarImage
          src={imageUrl}
          alt={agent.name}
        />
      )}
      <AvatarFallback size="lg" className="text-xl text-text-primary-on-surface">
        {agent.icon_type === 'emoji' && agent.icon ? agent.icon : agent.name[0]?.toLocaleUpperCase()}
      </AvatarFallback>
    </AvatarRoot>
  )
}

function AgentRosterField({
  agent,
}: {
  agent?: AgentRosterNodeData
}) {
  const { t } = useTranslation()

  if (!agent)
    return null

  return (
    <FieldRoot name="agent_roster" className="gap-1 px-4 py-2">
      <FieldLabel className="py-1 system-sm-semibold-uppercase">
        {t('nodes.agent.roster.label', { ns: 'workflow' })}
      </FieldLabel>
      <div className="flex h-13 min-w-0 items-center gap-2 rounded-lg bg-components-input-bg-normal p-2">
        <AgentRosterAvatar agent={agent} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
          <div className="truncate system-sm-medium text-text-secondary">
            {agent.name}
          </div>
          <div className="truncate system-xs-regular text-text-tertiary">
            {agent.description}
          </div>
        </div>
      </div>
    </FieldRoot>
  )
}

export function AgentPanel({
  data,
}: NodePanelProps<AgentNodeType>) {
  const { t } = useTranslation()

  return (
    <div className="my-2">
      <AgentRosterField agent={data.agent_roster} />
      <div>
        <OutputVars>
          <VarItem
            name="text"
            type="String"
            description={t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })}
          />
          <VarItem
            name="usage"
            type="object"
            description={t(`${i18nPrefix}.outputVars.usage`, { ns: 'workflow' })}
          />
          <VarItem
            name="files"
            type="Array[File]"
            description={t(`${i18nPrefix}.outputVars.files.title`, { ns: 'workflow' })}
          />
          <VarItem
            name="json"
            type="Array[Object]"
            description={t(`${i18nPrefix}.outputVars.json`, { ns: 'workflow' })}
          />
        </OutputVars>
      </div>
    </div>
  )
}
