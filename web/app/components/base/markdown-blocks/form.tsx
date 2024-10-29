// const MarkdownForm = ({ node }: any) => {
//   // const supportedTypes = ['text', 'password', 'email', 'number', 'radio']
//   return (
//     <form className='flex flex-col gap-4 self-stretch'>
//       {node.children.map((child: any, index: number) => {
//         console.log(child)
//         if (child.tagName === 'label') {
//           return (
//             <label key={index} htmlFor={child.properties.for}>
//               {child.children[0]?.value || ''}
//             </label>
//           )
//         }
//         if (child.tagName === 'input') {
//           return (
//             <Input
//               key={index}
//               type={child.properties.type}
//               name={child.properties.name}
//               placeholder={child.properties.placeholder}
//             />
//           )
//         }
//         if (child.tagName === 'button') {
//           return (
//             <Button
//               key={index}
//               onClick={(e) => {
//                 e.preventDefault()
//                 console.log('form submitted with data:', node.children)
//               }}
//             >
//               <span className='text-[13px]'>{child.children[0]?.value || ''}</span>
//             </Button>
//           )
//         }

//         return null
//       })}
//     </form>
//   )
// }
