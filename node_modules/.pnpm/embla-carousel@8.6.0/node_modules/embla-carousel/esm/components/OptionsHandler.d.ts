import { LooseOptionsType, CreateOptionsType } from './Options.js';
import { WindowType } from './utils.js';
type OptionsType = Partial<CreateOptionsType<LooseOptionsType>>;
export type OptionsHandlerType = {
    mergeOptions: <TypeA extends OptionsType, TypeB extends OptionsType>(optionsA: TypeA, optionsB?: TypeB) => TypeA;
    optionsAtMedia: <Type extends OptionsType>(options: Type) => Type;
    optionsMediaQueries: (optionsList: OptionsType[]) => MediaQueryList[];
};
export declare function OptionsHandler(ownerWindow: WindowType): OptionsHandlerType;
export {};
