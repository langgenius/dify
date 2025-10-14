import { AnimationsType } from './Animations.js';
import { CounterType } from './Counter.js';
import { EventHandlerType } from './EventHandler.js';
import { ScrollBodyType } from './ScrollBody.js';
import { ScrollTargetType } from './ScrollTarget.js';
import { Vector1DType } from './Vector1d.js';
export type ScrollToType = {
    distance: (n: number, snap: boolean) => void;
    index: (n: number, direction: number) => void;
};
export declare function ScrollTo(animation: AnimationsType, indexCurrent: CounterType, indexPrevious: CounterType, scrollBody: ScrollBodyType, scrollTarget: ScrollTargetType, targetVector: Vector1DType, eventHandler: EventHandlerType): ScrollToType;
