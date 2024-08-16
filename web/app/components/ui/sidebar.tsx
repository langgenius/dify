"use client";
import Link from "next/link";
import React, { createContext, useContext, useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { usePathname } from "next/navigation";
import { RiSettings3Fill, RiSettings3Line } from "@remixicon/react";
import LogoSite from "../base/logo/logo-site";
import { WorkspaceProvider } from "@/context/workspace-context";
import AccountDropdown from "../header/account-dropdown";

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// interface SidebarContextProps {
//   open: boolean;
//   setOpen: React.Dispatch<React.SetStateAction<boolean>>;
//   isMobile: boolean;
// }

// const SidebarContext = createContext<SidebarContextProps | undefined>(
//   undefined
// );

// export const useSidebar = () => {
//   const context = useContext(SidebarContext);
//   if (!context)
//     throw new Error("useSidebar must be used within a SidebarProvider");
//   return context;
// };

// export const SidebarProvider = ({
//   children,
// }: {
//   children: React.ReactNode;
// }) => {
//   const [open, setOpen] = useState(false);
//   const [isMobile, setIsMobile] = useState(false);

//   useEffect(() => {
//     const checkMobile = () => setIsMobile(window.innerWidth < 768);
//     checkMobile();
//     window.addEventListener("resize", checkMobile);
//     return () => window.removeEventListener("resize", checkMobile);
//   }, []);

//   return (
//     <SidebarContext.Provider value={{ open, setOpen, isMobile }}>
//       {children}
//     </SidebarContext.Provider>
//   );
// };

// export const Sidebar = ({ children }: { children: React.ReactNode }) => {
//   return <SidebarProvider>{children}</SidebarProvider>;
// };

interface SidebarBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  items: {
    label: string;
    activeIcon: React.ReactNode;
    inactiveIcon: React.ReactNode;
    href: string;
    position: "top" | "bottom";
  }[];
}

export const SidebarBody = ({ items }: SidebarBodyProps) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const path = usePathname();
  const activeLink = items.find((item) => path.includes(item.href))?.href;
  const isSettingsPage = path.includes("/settings");

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setIsOpen(false);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <motion.div
      className={cn(
        "px-2 py-4 flex flex-col flex-shrink-0 backdrop-blur-md  flex-nowrap border-x border-gray-300 border fixed h-screen left-0 top-0 z-10"
      )}
      initial={{ width: "60px" }}
      animate={{ width: isOpen && !isMobile ? "200px" : "60px" }}
      onHoverStart={() => !isMobile && setIsOpen(true)}
      onHoverEnd={() => !isMobile && setIsOpen(false)}
      transition={{ duration: 0.2 }}
    >
      <div className="flex flex-col h-full">
        <div className="flex flex-col gap-2 flex-grow">
          <Link href="/studio" className="flex items-center mb-4">
            <LogoSite className="h-10 w-auto" />
          </Link>
          <WorkspaceProvider>
            <AccountDropdown isMobile={!isOpen} />
          </WorkspaceProvider>
          {items.map((item, index) => {
            return (
              <Link
                href={item.href}
                key={`navlink-${index}`}
                className={cn(
                  "flex flex-nowrap gap-2.5 items-center transition-all rounded-md",
                  activeLink === item.href
                    ? "bg-white shadow-sm"
                    : "hover:bg-gray-300"
                )}
              >
                <div className="p-2.5 rounded-md">
                  {activeLink === item.href
                    ? item.activeIcon
                    : item.inactiveIcon}
                </div>
                <AnimatePresence>
                  {isOpen && !isMobile && (
                    <motion.div
                      initial={{ x: -5 }}
                      animate={{ x: 0 }}
                      exit={{ x: -5 }}
                      transition={{ duration: 0.1, ease: "linear" }}
                      className={cn(
                        "text-sm",
                        activeLink === item.href && "font-medium"
                      )}
                    >
                      {item.label}
                    </motion.div>
                  )}
                </AnimatePresence>
              </Link>
            );
          })}
        </div>
        <div className="mt-auto space-y-2">
          <Link
            href={"/settings"}
            key={`navlink-settings`}
            className={cn(
              "flex flex-nowrap gap-2.5 items-center transition-all rounded-md",
              isSettingsPage ? "bg-white shadow-sm" : "hover:bg-gray-300"
            )}
          >
            <div className="p-2.5 rounded-md">
              {isSettingsPage ? (
                <RiSettings3Fill className="size-5" />
              ) : (
                <RiSettings3Line className="size-5" />
              )}
            </div>
            {isOpen && !isMobile && (
              <div className={cn("text-sm", isSettingsPage && "font-medium")}>
                Settings
              </div>
            )}
          </Link>
        </div>
      </div>
    </motion.div>
  );
};

// export const SidebarLink = ({
//   activeIcon,
//   inactiveIcon,
//   href,
//   label,
//   ...props
// }: {
//   activeIcon: React.ReactNode;
//   isActive: boolean;
//   label: string;
//   inactiveIcon: React.ReactNode;
//   href: string;
// } & LinkProps) => {
//   const { open } = useSidebar();
//   const isActive = usePathname().includes(href);

//   return (
//     <Link href={href} className={cn("grid grid-cols-4 p-2 gap-2  ")} {...props}>
//       <div className="w-[40px]">{isActive ? activeIcon : inactiveIcon}</div>
//       <div className="w-[180px]  text-start">{label} </div>
//     </Link>
//   );
// };
