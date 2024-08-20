"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWRInfinite from "swr/infinite";
import { useTranslation } from "react-i18next";
import { useDebounceFn } from "ahooks";
import {
  RiExchange2Line,
  RiMessage3Line,
  RiRobot3Line,
} from "@remixicon/react";
import AppCard from "./AppCard";
import NewAppCard from "./NewAppCard";
import useAppsQueryState from "./hooks/useAppsQueryState";
import s from "./style.module.css";
import type { AppListResponse } from "@/models/app";
import { fetchAppList } from "@/service/apps";
import { useAppContext } from "@/context/app-context";
import { NEED_REFRESH_APP_LIST_KEY } from "@/config";
import { CheckModal } from "@/hooks/use-pay";
import TabSliderNew from "@/app/components/base/tab-slider-new";
import { useTabSearchParams } from "@/hooks/use-tab-searchparams";
import SearchInput from "@/app/components/base/search-input";
import { useStore as useTagStore } from "@/app/components/base/tag-management/store";
import TagManagementModal from "@/app/components/base/tag-management";
import TagFilter from "@/app/components/base/tag-management/filter";
import CreateNewApp from "./CreateNewAppCard";

const getKey = (
  pageIndex: number,
  previousPageData: AppListResponse,
  activeTab: string,
  tags: string[],
  keywords: string
) => {
  if (!pageIndex || previousPageData.has_more) {
    const params: any = {
      url: "apps",
      params: { page: pageIndex + 1, limit: 30, name: keywords },
    };

    if (activeTab !== "all") params.params.mode = activeTab;
    else delete params.params.mode;

    if (tags.length) params.params.tag_ids = tags;

    return params;
  }
  return null;
};

const Apps = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } =
    useAppContext();
  const showTagManagementModal = useTagStore((s) => s.showTagManagementModal);
  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: "all",
  });
  const {
    query: { tagIDs = [], keywords = "" },
    setQuery,
  } = useAppsQueryState();
  const [tagFilterValue, setTagFilterValue] = useState<string[]>(tagIDs);
  const [searchKeywords, setSearchKeywords] = useState(keywords);
  const setKeywords = useCallback(
    (keywords: string) => {
      setQuery((prev) => ({ ...prev, keywords }));
    },
    [setQuery]
  );
  const setTagIDs = useCallback(
    (tagIDs: string[]) => {
      setQuery((prev) => ({ ...prev, tagIDs }));
    },
    [setQuery]
  );

  const { data, isLoading, setSize, mutate } = useSWRInfinite(
    (pageIndex: number, previousPageData: AppListResponse) =>
      getKey(pageIndex, previousPageData, activeTab, tagIDs, searchKeywords),
    fetchAppList,
    { revalidateFirstPage: true }
  );

  const anchorRef = useRef<HTMLDivElement>(null);
  const options = [
    /*     { value: 'all', text: t('app.types.all'), icon: <RiApps2Line className='w-[14px] h-[14px] mr-1' /> },
     */ {
      value: "chat",
      text: t("app.types.chatbot"),
      icon: <RiMessage3Line className="w-[14px] h-[14px] mr-1" />,
    },
    {
      value: "agent-chat",
      text: t("app.types.agent"),
      icon: <RiRobot3Line className="w-[14px] h-[14px] mr-1" />,
    },
    {
      value: "workflow",
      text: t("app.types.workflow"),
      icon: <RiExchange2Line className="w-[14px] h-[14px] mr-1" />,
    },
  ];

  useEffect(() => {
    document.title = `${t("common.menus.apps")} -  Dify`;
    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === "1") {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY);
      mutate();
    }
  }, []);

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator) return router.replace("/datasets");
  }, [isCurrentWorkspaceDatasetOperator]);

  const hasMore = data?.at(-1)?.has_more ?? true;
  useEffect(() => {
    let observer: IntersectionObserver | undefined;
    if (anchorRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !isLoading && hasMore)
            setSize((size: number) => size + 1);
        },
        { rootMargin: "100px" }
      );
      observer.observe(anchorRef.current);
    }
    return () => observer?.disconnect();
  }, [isLoading, setSize, anchorRef, mutate, hasMore]);

  const { run: handleSearch } = useDebounceFn(
    () => {
      setSearchKeywords(keywords);
    },
    { wait: 500 }
  );
  const handleKeywordsChange = (value: string) => {
    setKeywords(value);
    handleSearch();
  };

  const { run: handleTagsUpdate } = useDebounceFn(
    () => {
      setTagIDs(tagFilterValue);
    },
    { wait: 500 }
  );
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value);
    handleTagsUpdate();
  };

  const totalApps = data?.reduce((prev, curr) => prev + curr.total, 0);

  return (
    <>
      <div className="shrink-0 pt-6 px-12">
        <div className={`mb-1 ${s.textGradient} text-xl font-semibold`}>
          {t("explore.apps.title")}
        </div>
        <div className="text-gray-500 text-sm">
          {t("explore.apps.description")}
        </div>
      </div>
      <div className="sticky top-0 flex justify-end items-center pt-4 px-12 pb-2 leading-[56px] bg-gray-100 z-10 flex-wrap gap-y-2">
        {/* <TabSliderNew
          value={activeTab}
          onChange={setActiveTab}
          options={options}
        /> */}
        <div className="flex items-center gap-2">
          {isCurrentWorkspaceEditor && <CreateNewApp onSuccess={mutate} />}
          <TagFilter
            type="app"
            value={tagFilterValue}
            onChange={handleTagsChange}
          />
          <SearchInput
            className="w-[200px]"
            value={keywords}
            onChange={handleKeywordsChange}
          />
        </div>
      </div>
      {totalApps === 0 ? (
        isCurrentWorkspaceEditor && <NoApps button={<CreateNewApp />} />
      ) : (
        <nav className="grid content-start grid-cols-1 gap-4 px-12 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 grow shrink-0">
          {/* #TODO: we don't needs new app for now */}
          {/* {isCurrentWorkspaceEditor
          && <NewAppCard onSuccess={mutate} />} */}
          {data?.map(({ data: apps }: any) =>
            apps.map((app: any) => (
              <AppCard key={app.id} app={app} onRefresh={mutate} />
            ))
          )}
          <CheckModal />
        </nav>
      )}

      {showTagManagementModal && (
        <TagManagementModal type="app" show={showTagManagementModal} />
      )}
    </>
  );
};

export default Apps;

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/app/components/card";

export function NoApps({ button }: { button: React.ReactNode }) {
  return (
    <Card className="w-full max-w-md bg-white mx-auto mt-10">
      <CardHeader className="flex items-center gap-4">
        <div className="bg-blue-700 rounded-md p-3 flex items-center justify-center">
          <RocketIcon className="w-6 h-6 text-primary-foreground" />
        </div>
        <CardTitle>Why so empty?</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-center">
        It looks like you haven&#39;t created any apps yet. Get started by
        clicking the button below.
      </CardContent>
      <CardFooter className="flex justify-center items-center">
        {button}
      </CardFooter>
    </Card>
  );
}

function RocketIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}
