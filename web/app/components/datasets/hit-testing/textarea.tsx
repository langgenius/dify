import type { FC } from "react";
import { useContext } from 'use-context-selector'
import { DocumentTextIcon } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import { hitTesting } from "@/service/datasets";
import DatasetDetailContext from '@/context/dataset-detail'
import { HitTestingResponse } from "@/models/datasets";
import cn from "classnames";
import Button from "../../base/button";
import Tag from "../../base/tag";
import Tooltip from "../../base/tooltip";
import s from "./style.module.css";
import { asyncRunSafe } from "@/utils";

type Props = {
  datasetId: string;
  onUpdateList: () => void;
  setHitResult: (res: HitTestingResponse) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  text: string;
  setText: (v: string) => void;
};

const TextAreaWithButton: FC<Props> = ({
  datasetId,
  onUpdateList,
  setHitResult,
  setLoading,
  loading,
  text,
  setText,
}) => {
  const { t } = useTranslation();
  const { indexingTechnique } = useContext(DatasetDetailContext)

  // 处理文本框内容变化的函数
  function handleTextChange(event: any) {
    setText(event.target.value);
  }

  // 处理按钮点击的函数
  const onSubmit = async () => {
    setLoading(true);
    const [e, res] = await asyncRunSafe<HitTestingResponse>(
      hitTesting({ datasetId, queryText: text }) as Promise<HitTestingResponse>
    );
    if (!e) {
      setHitResult(res);
      onUpdateList?.();
    }
    setLoading(false);
  };

  return (
    <>
      <div className={s.wrapper}>
        <div className="flex items-center mb-3">
          <DocumentTextIcon className="w-4 h-4 text-primary-600 mr-2" />
          <span className="text-gray-800 font-semibold text-sm">
            {t("datasetHitTesting.input.title")}
          </span>
        </div>
        <textarea
          value={text}
          onChange={handleTextChange}
          placeholder={t("datasetHitTesting.input.placeholder") as string}
          className={s.textarea}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between mx-4 mt-2 mb-4">
          {text?.length > 200 ? (
            <Tooltip
              content={t("datasetHitTesting.input.countWarning") as string}
              selector="hit-testing-warning"
            >
              <div>
                <Tag color="red" className="!text-red-600">
                  {text?.length}
                  <span className="text-red-300 mx-0.5">/</span>
                  200
                </Tag>
              </div>
            </Tooltip>
          ) : (
            <Tag
              color="gray"
              className={cn("!text-gray-500", text?.length ? "" : "opacity-50")}
            >
              {text?.length}
              <span className="text-gray-300 mx-0.5">/</span>
              200
            </Tag>
          )}
          <Tooltip
            selector="hit-testing-submit"
            disabled={indexingTechnique === 'high_quality'}
            content={t("datasetHitTesting.input.indexWarning") as string}
          >
            <div>
              <Button
                onClick={onSubmit}
                type="primary"
                loading={loading}
                disabled={indexingTechnique !== 'high_quality' ? true : (!text?.length || text?.length > 200)}
              >
                {t("datasetHitTesting.input.testing")}
              </Button>
            </div>
          </Tooltip>
        </div>
      </div>
    </>
  );
};

export default TextAreaWithButton;
