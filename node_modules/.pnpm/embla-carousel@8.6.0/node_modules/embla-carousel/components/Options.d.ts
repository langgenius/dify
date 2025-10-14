import { AlignmentOptionType } from './Alignment';
import { AxisDirectionOptionType, AxisOptionType } from './Axis';
import { SlidesToScrollOptionType } from './SlidesToScroll';
import { ScrollContainOptionType } from './ScrollContain';
import { DragHandlerOptionType } from './DragHandler';
import { ResizeHandlerOptionType } from './ResizeHandler';
import { SlidesHandlerOptionType } from './SlidesHandler';
import { SlidesInViewOptionsType } from './SlidesInView';
import { FocusHandlerOptionType } from './SlideFocus';
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
