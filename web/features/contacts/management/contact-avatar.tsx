import type { AvatarProps } from '@langgenius/dify-ui/avatar'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import DefaultAvatar from './assets/default-avatar.svg'

export function ContactAvatar({
  avatar,
  className,
  name,
  size = 'md',
}: Pick<AvatarProps, 'size' | 'className'> & { avatar?: string | null; name: string }) {
  return (
    <Avatar
      size={size}
      aria-hidden
      className={cn('data-loading:bg-background-section-burn', className)}
      render={(props, { imageLoadingStatus }) => (
        <span
          {...props}
          data-loading={
            avatar && (imageLoadingStatus === 'idle' || imageLoadingStatus === 'loading')
              ? ''
              : undefined
          }
        />
      )}
    >
      {avatar && (
        <AvatarImage
          key={avatar.split('?')[0]}
          keepMounted
          src={avatar}
          alt=""
          className="data-error:invisible"
        />
      )}
      <AvatarFallback
        render={(props, { imageLoadingStatus }) => (
          <span {...props} aria-hidden>
            {(!avatar || imageLoadingStatus === 'error') &&
              (name ? (
                [...name][0]?.toLocaleUpperCase()
              ) : (
                <img
                  alt=""
                  src={DefaultAvatar.src}
                  className="absolute inset-s-1/8 top-[21.43%] h-[121.43%] w-3/4 max-w-none"
                />
              ))}
          </span>
        )}
      />
    </Avatar>
  )
}
