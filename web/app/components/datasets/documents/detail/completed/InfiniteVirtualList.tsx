import React, { FC, CSSProperties } from "react";
import { FixedSizeList as List } from "react-window";
import InfiniteLoader from "react-window-infinite-loader";
import type { SegmentDetailModel } from "@/models/datasets";
import SegmentCard from "./SegmentCard";
import s from "./style.module.css";

type IInfiniteVirtualListProps = {
  hasNextPage?: boolean; // Are there more items to load? (This information comes from the most recent API request.)
  isNextPageLoading: boolean; // Are we currently loading a page of items? (This may be an in-flight flag in your Redux store for example.)
  items: Array<SegmentDetailModel[]>; // Array of items loaded so far.
  loadNextPage: () => Promise<any>; // Callback function responsible for loading the next page of items.
  onClick: (detail: SegmentDetailModel) => void;
  onChangeSwitch: (segId: string, enabled: boolean) => Promise<void>;
};

const InfiniteVirtualList: FC<IInfiniteVirtualListProps> = ({
  hasNextPage,
  isNextPageLoading,
  items,
  loadNextPage,
  onClick: onClickCard,
  onChangeSwitch,
}) => {
  // If there are more items to be loaded then add an extra row to hold a loading indicator.
  const itemCount = hasNextPage ? items.length + 1 : items.length;

  // Only load 1 page of items at a time.
  // Pass an empty callback to InfiniteLoader in case it asks us to load more than once.
  const loadMoreItems = isNextPageLoading ? () => { } : loadNextPage;

  // Every row is loaded except for our loading indicator row.
  const isItemLoaded = (index: number) => !hasNextPage || index < items.length;

  // Render an item or a loading indicator.
  const Item = ({ index, style }: { index: number; style: CSSProperties }) => {
    let content;
    if (!isItemLoaded(index)) {
      content = (
        <>
          {[1, 2, 3].map((v) => (
            <SegmentCard loading={true} detail={{ position: v } as any} />
          ))}
        </>
      );
    } else {
      content = items[index].map((segItem) => (
        <SegmentCard
          key={segItem.id}
          detail={segItem}
          onClick={() => onClickCard(segItem)}
          onChangeSwitch={onChangeSwitch}
          loading={false}
        />
      ));
    }

    return (
      <div style={style} className={s.cardWrapper}>
        {content}
      </div>
    );
  };

  return (
    <InfiniteLoader
      itemCount={itemCount}
      isItemLoaded={isItemLoaded}
      loadMoreItems={loadMoreItems}
    >
      {({ onItemsRendered, ref }) => (
        <List
          ref={ref}
          className="List"
          height={800}
          width={"100%"}
          itemSize={200}
          itemCount={itemCount}
          onItemsRendered={onItemsRendered}
        >
          {Item}
        </List>
      )}
    </InfiniteLoader>
  );
};
export default InfiniteVirtualList;
