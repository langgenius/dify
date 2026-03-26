import type { FC } from 'react'
import type { SnippetListItem } from '@/types/snippet'
import AppIcon from '@/app/components/base/app-icon'

export type PublishedSnippetListItem = SnippetListItem

type SnippetDetailCardProps = {
  snippet: PublishedSnippetListItem
}

const SnippetDetailCard: FC<SnippetDetailCardProps> = ({
  snippet,
}) => {
  const { author, description, icon_info, name } = snippet

  return (
    <div className="w-[224px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 pb-4 pt-3 shadow-lg backdrop-blur-[5px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          <AppIcon
            size="tiny"
            iconType={icon_info.icon_type}
            icon={icon_info.icon}
            background={icon_info.icon_background}
            imageUrl={icon_info.icon_url}
          />
          <div className="text-text-primary system-md-medium">{name}</div>
        </div>
        {!!description && (
          <div className="w-[200px] text-text-secondary system-xs-regular">
            {description}
          </div>
        )}
      </div>
      {!!author && (
        <div className="pt-3 text-text-tertiary system-xs-regular">
          {author}
        </div>
      )}
    </div>
  )
}

export default SnippetDetailCard
