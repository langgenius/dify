import { LangGeniusClient } from "..";

describe('Client', () => {
    test('should create a client', () => {
        const client = new LangGeniusClient('test');
        expect(client).toBeDefined();
    })
});