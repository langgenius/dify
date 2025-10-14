import { AnimationsType } from './Animations';
import { CounterType } from './Counter';
import { EventHandlerType } from './EventHandler';
import { ScrollBodyType } from './ScrollBody';
import { ScrollTargetType } from './ScrollTarget';
import { Vector1DType } from './Vector1d';
export type ScrollToType = {
    distance: (n: number, snap: boolean) => void;
    index: (n: number, direction: number) => void;
};
export declare function ScrollTo(animation: AnimationsType, indexCurrent: CounterType, indexPrevious: CounterType, scrollBody: ScrollBodyType, scrollTarget: ScrollTargetType, targetVector: Vector1DType, eventHandler: EventHandlerType): ScrollToType;
