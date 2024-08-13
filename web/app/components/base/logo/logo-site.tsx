"use client";
import type { FC } from "react";
import classNames from "@/utils/classnames";
import { useSelector } from "@/context/app-context";
import Image, { ImageProps } from "next/image";

interface LogoSiteProps {
  className?: string;
}

const LogoSite: FC<LogoSiteProps> = ({ className, ...props }) => {
  const { theme } = useSelector((s) => {
    return {
      theme: s.theme,
    };
  });

  const src =
    theme === "light" ? "/logo/logo-site.png" : `/logo/logo-site-${theme}.png`;
  return (
    <Image
      width={2048}
      height={75}
      {...props}
      src="https://app.chaindesk.ai/_next/image?url=%2Flogo.png&w=2048&q=75"
      className={classNames("block object-contain w-auto h-10", className)}
      alt="logo"
    />
  );
};

export default LogoSite;
