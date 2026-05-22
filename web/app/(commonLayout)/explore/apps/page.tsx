import { basePath } from '@/utils/var'

const Apps = () => {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background-body">
      <img
        src={`${basePath}/logo/login_dg.png`}
        className="h-auto max-w-[240px] object-contain"
        alt="DG logo"
      />
    </div>
  )
}

export default Apps
