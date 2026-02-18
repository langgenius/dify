type HorizontalLineProps = {
  className?: string
}
const HorizontalLine = ({
  className,
}: HorizontalLineProps) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="2" viewBox="0 0 240 2" fill="none" className={className}>
      <path d="M0 1H240" stroke="url(#paint0_linear_8619_59125)" />
      <defs>
        <linearGradient id="paint0_linear_8619_59125" x1="240" y1="9.99584" x2="3.95539e-05" y2="9.88094" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.01" />
          <stop offset="0.9031" stopColor="#101828" stopOpacity="0.04" />
          <stop offset="1" stopColor="white" stopOpacity="0.01" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default HorizontalLine
