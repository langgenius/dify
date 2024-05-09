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
      // props: Props
      // Component: ComponentType<Props & MenuOptionRenderProps>
      onSelect?: () => void
      render: (menuRenderProps: MenuOptionRenderProps) => JSX.Element
    },
  ) {
    super(data.key)
    this.group = data.group
  }

  // public render = (menuRenderProps: MenuOptionRenderProps) => {
  //   const Component = this.data.Component
  //   return <Component key={this.data.key} {...menuRenderProps} {...this.data.props} />
  // }

  public onSelectMenuOption = () => this.data.onSelect?.()
  public renderMenuOption = (menuRenderProps: MenuOptionRenderProps) => <Fragment key={this.data.key}>{this.data.render(menuRenderProps)}</Fragment>
}
