import { AlignmentOptionType } from './Alignment.js';
import { AxisDirectionOptionType, AxisOptionType } from './Axis.js';
import { SlidesToScrollOptionType } from './SlidesToScroll.js';
import { ScrollContainOptionType } from './ScrollContain.js';
import { DragHandlerOptionType } from './DragHandler.js';
import { ResizeHandlerOptionType } from './ResizeHandler.js';
import { SlidesHandlerOptionType } from './SlidesHandler.js';
import { SlidesInViewOptionsType } from './SlidesInView.js';
import { FocusHandlerOptionType } from './SlideFocus.js';
export type LooseOptionsType = {
    [key: string]: unknown;
};
export type CreateOptionsType<Type extends LooseOptionsType> = Type & {
    active: boolean;
    breakpoints: {
        [key: string]: Omit<Partial<CreateOptionsType<Type>>, 'breakpoints'>;
    };
};
export type OptionsType = CreateOptionsType<{
    align: AlignmentOptionType;
    axis: AxisOptionType;
    container: string | HTMLElement | null;
    slides: string | HTMLElement[] | NodeListOf<HTMLElement> | null;
    containScroll: ScrollContainOptionType;
    direction: AxisDirectionOptionType;
    slidesToScroll: SlidesToScrollOptionType;
    dragFree: boolean;
    dragThreshold: number;
    inViewThreshold: SlidesInViewOptionsType;
    loop: boolean;
    skipSnaps: boolean;
    duration: number;
    startIndex: number;
    watchDrag: DragHandlerOptionType;
    watchResize: ResizeHandlerOptionType;
    watchSlides: SlidesHandlerOptionType;
    watchFocus: FocusHandlerOptionType;
}>;
export declare const defaultOptions: OptionsType;
export type EmblaOptionsType = Partial<OptionsType>;
