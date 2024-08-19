"use client";

// Libraries
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useDebounceFn } from "ahooks";
import useSWR from "swr";

// Components
import Datasets from "./Datasets";
import DatasetFooter from "./DatasetFooter";
import ApiServer from "./ApiServer";
import Doc from "./Doc";
import TabSliderNew from "@/app/components/base/tab-slider-new";
import SearchInput from "@/app/components/base/search-input";
import TagManagementModal from "@/app/components/base/tag-management";
import TagFilter from "@/app/components/base/tag-management/filter";

// Services
import { fetchDatasetApiBaseUrl } from "@/service/datasets";

// Hooks
import { useTabSearchParams } from "@/hooks/use-tab-searchparams";
import { useStore as useTagStore } from "@/app/components/base/tag-management/store";
import { useAppContext } from "@/context/app-context";
import Button from "@/app/components/base/button";

const Container = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentWorkspace, isCurrentWorkspaceEditor } = useAppContext();
  const showTagManagementModal = useTagStore((s) => s.showTagManagementModal);

  const options = useMemo(() => {
    return [
      { value: "dataset", text: t("dataset.datasets") },
      ...(currentWorkspace.role === "dataset_operator"
        ? []
        : [{ value: "api", text: t("dataset.datasetsApi") }]),
    ];
  }, [currentWorkspace.role, t]);

  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: "dataset",
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const { data } = useSWR(
    activeTab === "dataset" ? null : "/datasets/api-base-info",
    fetchDatasetApiBaseUrl
  );

  const [keywords, setKeywords] = useState("");
  const [searchKeywords, setSearchKeywords] = useState("");
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
  const [tagFilterValue, setTagFilterValue] = useState<string[]>([]);
  const [tagIDs, setTagIDs] = useState<string[]>([]);
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

  useEffect(() => {
    if (currentWorkspace.role === "normal") return router.replace("/studio");
  }, [currentWorkspace]);

  return (
    <div
      ref={containerRef}
      className="grow relative flex flex-col bg-gray-100 overflow-y-auto"
    >
      <div className="sticky top-0 flex flex-col pt-4 px-12 pb-2 leading-[56px] bg-gray-100 z-10 flex-wrap gap-y-2">
        <div className={`mb-1 text-blue-700 text-xl font-semibold`}>
          Datesets
        </div>

        <div className="text-gray-500 text-sm">Create and manage datasets</div>

        <div className="flex items-center justify-between gap-y-2">
          <TabSliderNew
            value={activeTab}
            onChange={(newActiveTab) => setActiveTab(newActiveTab)}
            options={options}
          />

          {activeTab === "dataset" && (
            <div className="flex items-center gap-2">
              {isCurrentWorkspaceEditor && (
                <Button
                  variant={"primary"}
                  onClick={() => router.push("/datasets/create")}
                >
                  Create +
                </Button>
              )}
              <TagFilter
                type="knowledge"
                value={tagFilterValue}
                onChange={handleTagsChange}
              />
              <SearchInput
                className="w-[200px]"
                value={keywords}
                onChange={handleKeywordsChange}
              />
            </div>
          )}
          {activeTab === "api" && data && (
            <div className="flex gap-2">
              {isCurrentWorkspaceEditor && (
                <Button
                  variant={"primary"}
                  onClick={() => router.push("/datasets/create")}
                >
                  Create +
                </Button>
              )}
              <ApiServer apiBaseUrl={data.api_base_url || ""} />
            </div>
          )}
        </div>
      </div>

      {activeTab === "dataset" && (
        <>
          <Datasets
            containerRef={containerRef}
            tags={tagIDs}
            keywords={searchKeywords}
          />
          <DatasetFooter />
          {showTagManagementModal && (
            <TagManagementModal
              type="knowledge"
              show={showTagManagementModal}
            />
          )}
        </>
      )}

      {activeTab === "api" && data && (
        <Doc apiBaseUrl={data.api_base_url || ""} />
      )}
    </div>
  );
};

export default Container;
