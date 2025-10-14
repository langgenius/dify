import { EmblaPluginType } from 'embla-carousel';
export declare function isObject(subject: unknown): subject is Record<string, unknown>;
export declare function isRecord(subject: unknown): subject is Record<string | number, unknown>;
export declare function canUseDOM(): boolean;
export declare function areOptionsEqual(optionsA: Record<string, unknown>, optionsB: Record<string, unknown>): boolean;
export declare function sortAndMapPluginToOptions(plugins: EmblaPluginType[]): EmblaPluginType['options'][];
export declare function arePluginsEqual(pluginsA: EmblaPluginType[], pluginsB: EmblaPluginType[]): boolean;
