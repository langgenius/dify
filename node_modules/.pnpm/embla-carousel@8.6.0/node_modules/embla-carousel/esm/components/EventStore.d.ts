type EventNameType = keyof DocumentEventMap | keyof WindowEventMap;
type EventHandlerType = (evt: any) => void;
type EventOptionsType = boolean | AddEventListenerOptions | undefined;
export type EventStoreType = {
    add: (node: EventTarget, type: EventNameType, handler: EventHandlerType, options?: EventOptionsType) => EventStoreType;
    clear: () => void;
};
export declare function EventStore(): EventStoreType;
export {};
