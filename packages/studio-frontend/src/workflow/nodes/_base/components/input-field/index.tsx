import { BoxGroupField } from '@/app/components/workflow/nodes/_base/components/layout'
import Add from '@/app/components/workflow/nodes/_base/components/input-field/add'

const InputField = () => {
  return (
    <BoxGroupField
      fieldProps={{
        supportCollapse: true,
        fieldTitleProps: {
          title: 'input field',
          operation: <Add />,
        },
      }}
      boxGroupProps={{
        boxProps: {
          withBorderBottom: true,
        },
      }}
    >
      input field
    </BoxGroupField>
  )
}
export default InputField
