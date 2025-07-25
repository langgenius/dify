import Empty from './empty'
import Item from './item'
import type { Node } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import { RelationType } from './types'
import { useTranslation } from 'react-i18next'
type ContainerProps = {
  nextNode?: Node
  relationType: RelationType
}

const Container = ({
  nextNode,
  relationType,
}: ContainerProps) => {
  const { t } = useTranslation()
  return (
    <div className={cn(
      'space-y-0.5 rounded-[10px] bg-background-section-burn p-0.5',
    )}>
      {nextNode && (
        <Item
          key={nextNode.id}
          nodeId={nextNode.id}
          data={nextNode.data}
        />
      )}
      {!nextNode && (
        <Empty display={relationType === RelationType.dependencies ? t('workflow.debug.relations.noDependencies') : t('workflow.debug.relations.noDependents')} />
      )}
    </div>
  )
}

export default Container
