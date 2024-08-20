"use client";

import { useEffect, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import { debounce } from "lodash-es";
import { useTranslation } from "react-i18next";
import NewDatasetCard from "./NewDatasetCard";
import DatasetCard from "./DatasetCard";
import type { DataSetListResponse } from "@/models/datasets";
import { fetchDatasets } from "@/service/datasets";
import { useAppContext } from "@/context/app-context";

const getKey = (
  pageIndex: number,
  previousPageData: DataSetListResponse,
  tags: string[],
  keyword: string
) => {
  if (!pageIndex || previousPageData.has_more) {
    const params: any = {
      url: "datasets",
      params: {
        page: pageIndex + 1,
        limit: 30,
      },
    };
    if (tags.length) params.params.tag_ids = tags;
    if (keyword) params.params.keyword = keyword;
    return params;
  }
  return null;
};

type Props = {
  containerRef: React.RefObject<HTMLDivElement>;
  tags: string[];
  keywords: string;
};

const Datasets = ({ containerRef, tags, keywords }: Props) => {
  const { isCurrentWorkspaceEditor } = useAppContext();
  const { data, isLoading, setSize, mutate } = useSWRInfinite(
    (pageIndex: number, previousPageData: DataSetListResponse) =>
      getKey(pageIndex, previousPageData, tags, keywords),
    fetchDatasets,
    { revalidateFirstPage: false, revalidateAll: true }
  );
  const loadingStateRef = useRef(false);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const { t } = useTranslation();

  const totalItems = data?.reduce((acc, item) => acc + item.data.length, 0);
  console.log(totalItems);

  useEffect(() => {
    loadingStateRef.current = isLoading;
    document.title = `${t("dataset.knowledge")} - Dify`;
  }, [isLoading]);

  useEffect(() => {
    const onScroll = debounce(() => {
      if (!loadingStateRef.current) {
        const { scrollTop, clientHeight } = containerRef.current!;
        const anchorOffset = anchorRef.current!.offsetTop;
        if (anchorOffset - scrollTop - clientHeight < 100)
          setSize((size) => size + 1);
      }
    }, 50);

    containerRef.current?.addEventListener("scroll", onScroll);
    return () => containerRef.current?.removeEventListener("scroll", onScroll);
  }, []);

  if (totalItems === 0) {
    return <NoApps />;
  }

  return (
    <nav className="grid content-start grid-cols-1 gap-4 px-12 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 grow shrink-0">
      {data?.map(({ data: datasets }) =>
        datasets.map((dataset) => (
          <DatasetCard key={dataset.id} dataset={dataset} onSuccess={mutate} />
        ))
      )}
    </nav>
  );
};

export default Datasets;

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/app/components/card";
import { Button } from "@/app/components/base/button";
import { useRouter } from "next/navigation";

export function NoApps() {
  const router = useRouter();

  return (
    <Card className="w-full max-w-md bg-white mx-auto mt-10">
      <CardHeader className="flex items-center gap-4">
        <div className="bg-blue-700 rounded-md p-3 flex items-center justify-center">
          <RocketIcon className="w-6 h-6 text-primary-foreground" />
        </div>
        <CardTitle>Why so empty?</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-center">
        It looks like you haven&#39;t created any data yet. Get started by
        clicking the button below.
      </CardContent>
      <CardFooter className="flex justify-center items-center">
        <Button
          variant="primary"
          onClick={() => {
            router.push("/datasets/create");
          }}
        >
          Create +
        </Button>
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
