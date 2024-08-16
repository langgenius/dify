"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useBoolean } from "ahooks";
import { useSelectedLayoutSegment } from "next/navigation";
import { Bars3Icon } from "@heroicons/react/20/solid";
import HeaderBillingBtn from "../billing/header-billing-btn";
import { SidebarBody } from "@/app/components/ui/sidebar";
import AccountDropdown from "@/app/components/header/account-dropdown";
import AppNav from "@/app/components/header/app-nav";
import DatasetNav from "@/app/components/header/dataset-nav";
import EnvNav from "@/app/components/header/env-nav";
import ExploreNav from "@/app/components/header/explore-nav";
import ToolsNav from "@/app/components/header/tools-nav";
import { WorkspaceProvider } from "@/context/workspace-context";
import { useAppContext } from "@/context/app-context";
import LogoSite from "@/app/components/base/logo/logo-site";
import useBreakpoints, { MediaType } from "@/hooks/use-breakpoints";
import { useProviderContext } from "@/context/provider-context";
import { useModalContext } from "@/context/modal-context";
import {
  RiBook2Fill,
  RiBook2Line,
  RiHammerFill,
  RiHammerLine,
  RiPlanetFill,
  RiPlanetLine,
  RiRobot2Fill,
  RiRobot2Line,
} from "@remixicon/react";

const navClassName = `
  flex items-center relative mr-0 sm:mr-3 px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`;
type SideBarWrapperProps = { children: React.ReactNode };

export function SidebarWrapper({ children }: SideBarWrapperProps) {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } =
    useAppContext();
  const selectedSegment = useSelectedLayoutSegment();
  const media = useBreakpoints();
  const isMobile = media === MediaType.mobile;
  const [isShowNavMenu, { toggle, setFalse: hideNavMenu }] = useBoolean(false);
  const { enableBilling, plan } = useProviderContext();
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext();
  const isFreePlan = plan.type === "sandbox";
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);

  const handlePlanClick = useCallback(() => {
    if (isFreePlan) setShowPricingModal();
    else setShowAccountSettingModal({ payload: "billing" });
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal]);

  useEffect(() => {
    hideNavMenu();
  }, [selectedSegment, hideNavMenu]);

  const sidebarBodyItems: {
    label: string;
    href: string;
    position: "top" | "bottom";
    activeIcon: React.ReactNode;
    inactiveIcon: React.ReactNode;
  }[] = [];

  if (!isCurrentWorkspaceDatasetOperator) {
    // sidebarBodyItems.push({
    //   label: "Explore",
    //   href: "/explore/apps",
    //   activeIcon: <RiPlanetFill className="size-5" />,
    //   inactiveIcon: <RiPlanetLine className="size-5" />,
    //   position: "top",
    // });

    sidebarBodyItems.push({
      label: "Studio",
      href: "/studio",
      activeIcon: <RiRobot2Fill className="size-5" />,
      inactiveIcon: <RiRobot2Line className="size-5" />,
      position: "top",
    });

    // TODO: we don't needs tools for now
    // sidebarBodyItems.push({
    //   label: "Plugins",
    //   href: "/tools",
    //   activeIcon: <RiHammerFill className="size-5" />,
    //   inactiveIcon: <RiHammerLine className="size-5" />,
    //   position: "top",
    // });
  }

  if (isCurrentWorkspaceDatasetOperator || isCurrentWorkspaceEditor) {
    sidebarBodyItems.push({
      label: "Dataset",
      href: "/datasets",
      activeIcon: <RiBook2Fill className="size-5" />,
      inactiveIcon: <RiBook2Line className="size-5" />,
      position: "top",
    });
  }

  return (
    <div className="flex h-screen">
      <SidebarBody items={sidebarBodyItems}>
        {/* <div className="flex items-center justify-between p-5">
          <Link href="/apps" className="flex items-center mb-4">
            <LogoSite className="size-10 mx-auto" />
          </Link>
        </div> */}

        {/* <nav className="flex-1  overflow-hidden px-4">
          <div className="flex flex-col space-y-2">
            <WorkspaceProvider>
              <AccountDropdown isMobile={false} />
            </WorkspaceProvider>
            {!isCurrentWorkspaceDatasetOperator && (
              <ExploreNav className={navClassName} />
            )}
            {!isCurrentWorkspaceDatasetOperator && <AppNav />}
            {(isCurrentWorkspaceEditor ||
              isCurrentWorkspaceDatasetOperator) && <DatasetNav />}
            {!isCurrentWorkspaceDatasetOperator && (
              <ToolsNav className={navClassName} />
            )}
          </div>
        </nav> */}

        {/* <div className="mt-auto p-4 space-y-4">
          <EnvNav />
          {enableBilling && (
            <div className="select-none">
              <HeaderBillingBtn onClick={handlePlanClick} />
            </div>
          )}
        </div> */}
      </SidebarBody>

      <div className="flex-1 flex flex-col ml-[60px] z-0">{children}</div>
    </div>
  );
}
