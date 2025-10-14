import { LimitType } from './Limit';
import { ScrollContainOptionType } from './ScrollContain';
import { SlidesToScrollType } from './SlidesToScroll';
export type SlideRegistryType = {
    slideRegistry: number[][];
};
export declare function SlideRegistry(containSnaps: boolean, containScroll: ScrollContainOptionType, scrollSnaps: number[], scrollContainLimit: LimitType, slidesToScroll: SlidesToScrollType, slideIndexes: number[]): SlideRegistryType;
