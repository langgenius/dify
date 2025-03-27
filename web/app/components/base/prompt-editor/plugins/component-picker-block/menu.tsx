import { MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { Fragment } from 'react'

/**
 * Corresponds to the `MenuRenderFn` type from `@lexical/react/LexicalTypeaheadMenuPlugin`.
 */
type MenuOptionRenderProps = {
  isSelected: boolean
  onSelect: () => void
  onSetHighlight: () => void
  queryString: string | null
}

export class PickerBlockMenuOption extends MenuOption {
  public group?: string

  constructor(
    private data: {
      key: string
      group?: string
      onSelect?: () => void
      render: (menuRenderProps: MenuOptionRenderProps) => React.JSX.Element
    },
  ) {
    super(data.key)
    this.group = data.group
  }

  public onSelectMenuOption = () => this.data.onSelect?.()
  public renderMenuOption = (menuRenderProps: MenuOptionRenderProps) => <Fragment key={this.data.key}>{this.data.render(menuRenderProps)}</Fragment>
}
