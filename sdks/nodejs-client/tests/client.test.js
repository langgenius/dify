import { LangGeniusClient } from '../index';

describe('LangGeniusClient', () => {
  it('should be defined', async () => {
    const client = new LangGeniusClient('your-api-key');
    expect(client).toBeDefined();
  });
});
