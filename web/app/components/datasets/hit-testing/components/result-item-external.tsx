"use client";
import type { FC } from "react"
import React from "react"
import { useBoolean } from "ahooks"
import SegmentCard from "@/app/components/datasets/documents/detail/completed/SegmentCard"
import type { ExternalKnowledgeBaseHitTesting } from "@/models/datasets"
import cn from "@/utils/classnames"
import Modal from "@/app/components/base/modal"
import s from "@/app/components/datasets/documents/detail/completed/style.module.css"

type Props = {
  payload: ExternalKnowledgeBaseHitTesting;
};

const ResultItemExternal: FC<Props> = ({ payload }) => {
  const record = payload;
  const [
    isShowDetailModal,
    { setTrue: showDetailModal, setFalse: hideDetailModal },
  ] = useBoolean(false);

  return (
    <div
      className={cn(
        "pt-3 bg-chat-bubble-bg rounded-xl hover:shadow-lg cursor-pointer"
      )}
      onClick={showDetailModal}
    >
      <SegmentCard
        loading={false}
        refSource={{
          title: record.title,
          uri: record.metadata
            ? record.metadata["x-amz-bedrock-kb-source-uri"]
            : "",
        }}
        isExternal
        contentExternal={record.content}
        score={record.score}
        scene="hitTesting"
        className="h-[216px] mb-4"
      />

      {isShowDetailModal && (
        <Modal
          className={"py-10 px-8"}
          closable
          onClose={hideDetailModal}
          isShow={isShowDetailModal}
        >
          <div className="w-full overflow-x-auto px-2">
            <div className={s.segModalContent}>
              <div className="mb-4 text-md text-gray-800 h-full">
                {record.content}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};


export default React.memo(ResultItemExternal);
