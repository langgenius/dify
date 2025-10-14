import { LimitType } from './Limit.js';
import { ScrollContainOptionType } from './ScrollContain.js';
import { SlidesToScrollType } from './SlidesToScroll.js';
export type SlideRegistryType = {
    slideRegistry: number[][];
};
export declare function SlideRegistry(containSnaps: boolean, containScroll: ScrollContainOptionType, scrollSnaps: number[], scrollContainLimit: LimitType, slidesToScroll: SlidesToScrollType, slideIndexes: number[]): SlideRegistryType;
