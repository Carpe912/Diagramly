import { describe, expect, it, vi } from 'vitest';
import {
  CoopwireApi,
  coopwireConfigSchema,
  refreshCoopwireSession,
} from '../src/adapters/coopwire/api';
import { testConfig } from './support/coopwire';

describe('Coopwire 接口地址', () => {
  it.each([
    ['', ''],
    ['  ', ''],
    ['/', ''],
    ['/rest', ''],
    [' /rest/ ', ''],
    ['https://coop.example.test', 'https://coop.example.test'],
    ['https://coop.example.test/', 'https://coop.example.test'],
    ['https://coop.example.test/rest/', 'https://coop.example.test'],
    ['https://coop.example.test/rest/rest', 'https://coop.example.test'],
    ['https://coop.example.test/api/rest/', 'https://coop.example.test/api'],
    ['http://localhost:8080/rest', 'http://localhost:8080'],
  ])('地址 %j 统一为 %j，业务请求与登录刷新共用路径规则', async (baseUrl, expected) => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      Response.json({ code: 0, results: [] }),
    );
    const api = new CoopwireApi({ ...testConfig, baseUrl }, fetcher as unknown as typeof fetch);
    expect(api.config.baseUrl).toBe(expected);
    await api.organizations();
    expect(fetcher.mock.calls[0][0]).toBe(
      `${expected}/rest/quality/investigate/scope/p/project_test/qryOrgs`,
    );
    expect(fetcher.mock.calls[0][1].credentials).toBe('include');
    await refreshCoopwireSession(baseUrl, fetcher as unknown as typeof fetch);
    expect(fetcher.mock.calls[1][0]).toBe(`${expected}/rest/platform/refreshToken`);
    expect(fetcher.mock.calls[1][1].body).toBeNull();
    expect(coopwireConfigSchema.parse({ ...testConfig, baseUrl: api.config.baseUrl }).baseUrl).toBe(
      expected,
    );
  });
  it.each([
    'https://user:password@coop.example.test/rest',
    'javascript:alert(1)',
    'file:///rest',
    '//coop.example.test',
    '/api',
    'coop.example.test',
    'https://coop.example.test?project=a',
    'https://coop.example.test#section',
  ])('拒绝无效或含凭证的接口地址 %j', (baseUrl) => {
    expect(() => new CoopwireApi({ ...testConfig, baseUrl })).toThrow('接口地址请填写');
  });
});
