import React from "react";
import SidebarDrawer from "./sidebar-drawer";
import { useMediaQuery } from "usehooks-ts";
import Sidebar from "./sidebar";

import { Icon } from "@iconify/react";
import {
  Avatar,
  Button,
  Chip,
  Spacer,
  Tab,
  Tabs,
  Tooltip,
  useDisclosure,
} from "@nextui-org/react";

import cn from "@/utils/classnames";
import Link from "next/link";

interface SidebarItem {
  key: string;
  href: string;
  icon: React.ReactNode;
  title: string;
  element: React.ReactNode | undefined | null;
}

interface SideBarProps {
  company: SidebarItem;
  appNav: SidebarItem;
  exploreNav: SidebarItem;
  datasetNav: SidebarItem;
  toolsNav: SidebarItem;
  isOpen: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isMobile: boolean;
}

export function SideBar({
  isOpen,
  onOpenChange,
  isCollapsed,
  setIsCollapsed,
  company,
  appNav,
  exploreNav,
  datasetNav,
  toolsNav,
  isMobile,
}: SideBarProps) {
  const onToggle = React.useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <SidebarDrawer
      className={cn("min-w-[288px] rounded-lg", {
        "min-w-[76px]": isCollapsed,
      })}
      hideCloseButton={true}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <div
        className={cn(
          "will-change relative flex h-full w-72 flex-col bg-default-100 p-6 transition-width",
          {
            "w-[83px] items-center px-[6px] py-6": isCollapsed,
          }
        )}
      >
        <div
          className={cn("flex items-center gap-3 pl-2", {
            "justify-center gap-0 pl-0": isCollapsed,
          })}
        >
          <span
            className={cn("w-full text-small font-bold uppercase opacity-100", {
              "w-0 opacity-0": isCollapsed,
            })}
          >
            Acme
          </span>

          {/* collase icon */}
          <div
            className={cn("flex-end flex", { hidden: isCollapsed })}
            onClick={() => (isMobile ? onOpenChange(!isCollapsed) : onToggle())}
          >
            <Icon
              className="cursor-pointer text-black  dark:text-primary-foreground/60 [&>g]:stroke-[1px]"
              icon="solar:round-alt-arrow-left-line-duotone"
              width={24}
            />
          </div>
        </div>

        <SidebarElement element={company} isCollapsed={isCollapsed} />
        <SidebarElement element={appNav} isCollapsed={isCollapsed} />
        <SidebarElement element={exploreNav} isCollapsed={isCollapsed} />
        <SidebarElement element={datasetNav} isCollapsed={isCollapsed} />
        <SidebarElement element={toolsNav} isCollapsed={isCollapsed} />

        {/* usef info  */}
        {/* {/* <Spacer y={6} /> */}
        {/* <div className="flex items-center gap-3 px-3">
          <Avatar
            isBordered
            size="sm"
            src="https://nextuipro.nyc3.cdn.digitaloceanspaces.com/components-images/avatars/e1b8ec120710c09589a12c0004f85825.jpg"
          />
          <div
            className={cn("flex max-w-full flex-col", { hidden: isCollapsed })}
          >
            <p className="text-small font-medium text-foreground">Kate Moore</p>
            <p className="text-tiny font-medium text-default-400">
              Customer Support
            </p>
          </div>
        </div> */}

        {/* <Spacer y={6} />

        {exploreNav}
        {appNav}
        {datasetNav}
        {toolsNav} */}

        {/* <Sidebar
          defaultSelectedKey="settings"
          iconClassName="group-data-[selected=true]:text-default-50"
          isCompact={isCollapsed}
          itemClasses={{
            base: "px-3 rounded-large data-[selected=true]:!bg-foreground",
            title: "group-data-[selected=true]:text-default-50",
          }}
          items={items}
        /> */}

        {/* <div
          className={cn("mt-auto flex flex-col", {
            "items-center": isCollapsed,
          })}
        >
          {isCollapsed && (
            <Button
              isIconOnly
              className="flex h-10 w-10 text-default-600"
              size="sm"
              variant="light"
            >
              <Icon
                className="cursor-pointer dark:text-primary-foreground/60 [&>g]:stroke-[1px]"
                height={24}
                icon="solar:round-alt-arrow-right-line-duotone"
                width={24}
                onClick={onToggle}
              />
            </Button>
          )}
          <Tooltip
            content="Support"
            isDisabled={!isCollapsed}
            placement="right"
          >
            <Button
              fullWidth
              className={cn(
                "justify-start truncate text-default-600 data-[hover=true]:text-foreground",
                {
                  "justify-center": isCollapsed,
                }
              )}
              isIconOnly={isCollapsed}
              startContent={
                isCollapsed ? null : (
                  <Icon
                    className="flex-none text-default-600"
                    icon="solar:info-circle-line-duotone"
                    width={24}
                  />
                )
              }
              variant="light"
            >
              {isCollapsed ? (
                <Icon
                  className="text-default-500"
                  icon="solar:info-circle-line-duotone"
                  width={24}
                />
              ) : (
                "Support"
              )}
            </Button>
          </Tooltip>
          <Tooltip
            content="Log Out"
            isDisabled={!isCollapsed}
            placement="right"
          >
            <Button
              className={cn(
                "justify-start text-default-500 data-[hover=true]:text-foreground",
                {
                  "justify-center": isCollapsed,
                }
              )}
              isIconOnly={isCollapsed}
              startContent={
                isCollapsed ? null : (
                  <Icon
                    className="flex-none rotate-180 text-default-500"
                    icon="solar:minus-circle-line-duotone"
                    width={24}
                  />
                )
              }
              variant="light"
            >
              {isCollapsed ? (
                <Icon
                  className="rotate-180 text-default-500"
                  icon="solar:minus-circle-line-duotone"
                  width={24}
                />
              ) : (
                "Log Out"
              )}
            </Button>
          </Tooltip>
        </div> */}
      </div>
    </SidebarDrawer>
  );
}

function SidebarElement({
  element,
  isCollapsed,
}: {
  element: SidebarItem;
  isCollapsed: boolean;
}) {
  return (
    <Tooltip
      content={element.title}
      isDisabled={!isCollapsed}
      placement="right"
    >
      {!isCollapsed && element.element}

      {isCollapsed && (
        <Link
          href={element.href}
          className="flex w-full items-center h-11 px-3 rounded-lg bg-gray-100 border border-gray-200 shadow-xs"
        >
          {element.icon}
        </Link>
      )}
    </Tooltip>
  );
}
