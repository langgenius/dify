import type { FC } from 'react'
import BasePanel from '../_base/panel'

const Panel: FC = () => {
  return (
    <BasePanel
      inputsElement={<div>start panel inputs</div>}
      ouputsElement={<div>start panel outputs</div>}
    />
  )
}

export default Panel
