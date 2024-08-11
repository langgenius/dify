// import type { CSSProperties } from "react";
// import React from "react";
// import { type VariantProps, cva } from "class-variance-authority";
// import Spinner from "../spinner";
// import classNames from "@/utils/classnames";
// import { Button as NextUIButton } from "@nextui-org/react";

// const buttonVariants = cva("btn disabled:btn-disabled", {
//   variants: {
//     variant: {
//       primary: "btn-primary",
//       warning: "btn-warning",
//       secondary: "btn-secondary",
//       "secondary-accent": "btn-secondary-accent",
//       ghost: "btn-ghost",
//       "ghost-accent": "btn-ghost-accent",
//       tertiary: "btn-tertiary",
//     },
//     size: {
//       small: "btn-small",
//       medium: "btn-medium",
//       large: "btn-large",
//     },
//   },
//   defaultVariants: {
//     variant: "secondary",
//     size: "medium",
//   },
// });

// export type ButtonProps = {
//   destructive?: boolean;
//   loading?: boolean;
//   styleCss?: CSSProperties;
// } & React.ButtonHTMLAttributes<HTMLButtonElement> &
//   VariantProps<typeof buttonVariants>;

// const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
//   (
//     {
//       className,
//       variant,
//       size,
//       destructive,
//       loading,
//       styleCss,
//       children,
//       ...props
//     },
//     ref
//   ) => {
//     return (
//       <button
//         type="button"
//         className={classNames(
//           buttonVariants({ variant, size, className }),
//           destructive && "btn-destructive"
//         )}
//         ref={ref}
//         style={styleCss}
//         {...props}
//       >
//         {children}
//         {loading && (
//           <Spinner
//             loading={loading}
//             className="!text-white !h-3 !w-3 !border-2 !ml-1"
//           />
//         )}
//       </button>
//     );
//   }
// );
// Button.displayName = "Button";

// export default Button;
// export { Button, buttonVariants };
import React from "react";
import {
  Button as NextUIButton,
  ButtonProps as NextUIButtonProps,
} from "@nextui-org/react";
import { type VariantProps, cva } from "class-variance-authority";
// import Spinner from "../spinner";
import classNames from "@/utils/classnames";

// Keep your existing buttonVariants
const buttonVariants = cva("btn disabled:btn-disabled", {
  variants: {
    variant: {
      primary: "btn-primary",
      warning: "btn-warning",
      secondary: "btn-secondary",
      "secondary-accent": "btn-secondary-accent",
      ghost: "btn-ghost",
      "ghost-accent": "btn-ghost-accent",
      tertiary: "btn-tertiary",
    },
    size: {
      small: "btn-small",
      medium: "btn-medium",
      large: "btn-large",
    },
  },
  defaultVariants: {
    variant: "secondary",
    size: "medium",
  },
});

// Keep your existing ButtonProps
export type ButtonProps = {
  destructive?: boolean;
  loading?: boolean;
  styleCss?: React.CSSProperties;
} & React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

// Map your variants to NextUI variants
const variantMap = {
  primary: "solid",
  warning: "flat",
  secondary: "bordered",
  "secondary-accent": "light",
  ghost: "ghost",
  "ghost-accent": "faded",
  tertiary: "shadow",
} as Record<string, NextUIButtonProps["variant"]>;

// Map your sizes to NextUI sizes
const sizeMap = {
  small: "sm",
  medium: "md",
  large: "lg",
} as Record<string, NextUIButtonProps["size"]>;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      destructive,
      loading,
      styleCss,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <NextUIButton
        ref={ref}
        variant={variantMap[variant as keyof typeof variantMap] || "solid"}
        size={sizeMap[size as keyof typeof sizeMap] || "md"}
        color={destructive ? "danger" : "default"}
        isLoading={loading}
        style={styleCss}
        className={classNames(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
        {/* {loading && <Spinner loading={loading} className='!text-white !h-3 !w-3 !border-2 !ml-1' />} */}
      </NextUIButton>
    );
  }
);

Button.displayName = "Button";

export default Button;
export { Button, buttonVariants };
