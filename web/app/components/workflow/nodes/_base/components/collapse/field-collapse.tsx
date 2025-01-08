import Collapse from '.'

type FieldCollapseProps = {
  title: string
  children: JSX.Element
}
const FieldCollapse = ({
  title,
  children,
}: FieldCollapseProps) => {
  return (
    <div className='py-4'>
      <Collapse
        trigger={
          <div className='flex items-center h-6 system-sm-semibold-uppercase text-text-secondary cursor-pointer'>{title}</div>
        }
      >
        <div className='px-4'>
          {children}
        </div>
      </Collapse>
    </div>
  )
}

export default FieldCollapse
