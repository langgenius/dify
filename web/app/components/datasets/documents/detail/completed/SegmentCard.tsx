import type { FC } from "react";
import React from "react";
import cn from "classnames";
import { ArrowUpRightIcon } from "@heroicons/react/24/outline";
import Switch from "@/app/components/base/switch";
import Divider from "@/app/components/base/divider";
import Indicator from "@/app/components/header/indicator";
import { formatNumber } from "@/utils/format";
import type { SegmentDetailModel } from "@/models/datasets";
import { StatusItem } from "../../list";
import s from "./style.module.css";
import { SegmentIndexTag } from "./index";
import { DocumentTitle } from '../index'
import { useTranslation } from "react-i18next";

const ProgressBar: FC<{ percent: number; loading: boolean }> = ({ percent, loading }) => {
  return (
    <div className={s.progressWrapper}>
      <div className={cn(s.progress, loading ? s.progressLoading : '')}>
        <div
          className={s.progressInner}
          style={{ width: `${loading ? 0 : (percent * 100).toFixed(2)}%` }}
        />
      </div>
      <div className={loading ? s.progressTextLoading : s.progressText}>{loading ? null : percent.toFixed(2)}</div>
    </div>
  )
}

export type UsageScene = 'doc' | 'hitTesting'

type ISegmentCardProps = {
  loading: boolean;
  detail?: SegmentDetailModel & { document: { name: string } };
  score?: number
  onClick?: () => void;
  onChangeSwitch?: (segId: string, enabled: boolean) => Promise<void>;
  scene?: UsageScene
  className?: string;
};

const SegmentCard: FC<ISegmentCardProps> = ({
  detail = {},
  score,
  onClick,
  onChangeSwitch,
  loading = true,
  scene = 'doc',
  className = ''
}) => {
  const { t } = useTranslation()
  const {
    id,
    position,
    enabled,
    content,
    word_count,
    hit_count,
    index_node_hash,
  } = detail as any;
  const isDocScene = scene === 'doc'

  return (
    <div
      className={cn(
        s.segWrapper,
        isDocScene && !enabled ? "bg-gray-25" : "",
        "group",
        !loading ? "pb-4" : "",
        className,
      )}
      onClick={() => onClick?.()}
    >
      <div className={s.segTitleWrapper}>
        {isDocScene ? <>
          <SegmentIndexTag positionId={position} className={cn("w-fit group-hover:opacity-100", isDocScene && !enabled ? 'opacity-50' : '')} />
          <div className={s.segStatusWrapper}>
            {loading ? (
              <Indicator
                color="gray"
                className="bg-gray-200 border-gray-300 shadow-none"
              />
            ) : (
              <>
                <StatusItem status={enabled ? "enabled" : "disabled"} reverse textCls="text-gray-500 text-xs" />
                <div className="hidden group-hover:inline-flex items-center">
                  <Divider type="vertical" className="!h-2" />
                  <div
                    onClick={(e: React.MouseEvent<HTMLDivElement, MouseEvent>) =>
                      e.stopPropagation()
                    }
                    className="inline-flex items-center"
                  >
                    <Switch
                      size='md'
                      defaultValue={enabled}
                      onChange={async (val) => {
                        await onChangeSwitch?.(id, val)
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </> : <div className={s.hitTitleWrapper}>
          <div className={cn(s.commonIcon, s.targetIcon, loading ? '!bg-gray-300' : '', '!w-3.5 !h-3.5')} />
          <ProgressBar percent={score ?? 0} loading={loading} />
        </div>}
      </div>
      {loading ? (
        <div className={cn(s.cardLoadingWrapper, s.cardLoadingIcon)}>
          <div className={cn(s.cardLoadingBg)} />
        </div>
      ) : (
        isDocScene ? <>
          <div
            className={cn(
              s.segContent,
              enabled ? "" : "opacity-50",
              "group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-b"
            )}
          >
            {content}
          </div>
          <div className={cn('group-hover:flex', s.segData)}>
            <div className="flex items-center mr-6">
              <div className={cn(s.commonIcon, s.typeSquareIcon)}></div>
              <div className={s.segDataText}>{formatNumber(word_count)}</div>
            </div>
            <div className="flex items-center mr-6">
              <div className={cn(s.commonIcon, s.targetIcon)} />
              <div className={s.segDataText}>{formatNumber(hit_count)}</div>
            </div>
            <div className="flex items-center">
              <div className={cn(s.commonIcon, s.bezierCurveIcon)} />
              <div className={s.segDataText}>{index_node_hash}</div>
            </div>
          </div>
        </> : <>
          <div className="h-[140px] overflow-hidden text-ellipsis text-sm font-normal text-gray-800">
            {content}
          </div>
          <div className={cn("w-full bg-gray-50 group-hover:bg-white")}>
            <Divider />
            <div className="relative flex items-center w-full">
              <DocumentTitle
                name={detail?.document?.name || ''}
                extension={(detail?.document?.name || '').split('.').pop() || 'txt'}
                wrapperCls='w-full'
                iconCls="!h-4 !w-4 !bg-contain"
                textCls="text-xs text-gray-700 !font-normal overflow-hidden whitespace-nowrap text-ellipsis"
              />
              <div className={cn(s.chartLinkText, 'group-hover:inline-flex')}>
                {t('datasetHitTesting.viewChart')}
                <ArrowUpRightIcon className="w-3 h-3 ml-1 stroke-current stroke-2" />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SegmentCard;
