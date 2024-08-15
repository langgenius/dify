import React from "react";
import type { FC } from "react";
import GA, { GaType } from "@/app/components/base/ga";
import { SidebarWrapper } from "../components/sidebar/sidebarWrapper";

const Layout: FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return (
    <div className="min-w-[300px] h-screen pb-[env(safe-area-inset-bottom)]">
      <GA gaType={GaType.webapp} />
      {children}
    </div>
  );
};

export default Layout;
