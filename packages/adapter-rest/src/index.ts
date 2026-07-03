import type { AdapterResolvers } from '@agent-ready/core';

export type RestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RestEndpointConfig = {
  method: RestMethod;
  /** The URL path, can include placeholders like {id} */
  url: string;
  /** Custom headers to send */
  headers?: Record<string, string>;
  /** Whether to send params as query string (default for GET/DELETE) or JSON body (default for POST/PUT/PATCH) */
  sendParamsAs?: 'query' | 'body';
  /** Function to extract the desired result from the response data */
  transformResponse?: (data: any, response: Response) => any;
};

export type RestResolverConfig = {
  /** Map predicate name to endpoint config or custom function */
  [predicateName: string]: RestEndpointConfig | ((params: Record<string, unknown>, config: RestClientConfig) => Promise<any>);
};

export type RestClientConfig = {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  /** Custom fetch implementation (e.g. for Node 16 or mock tests) */
  fetchFn?: typeof fetch;
};

function fillUrlPlaceholders(url: string, params: Record<string, unknown>): { finalUrl: string; remainingParams: Record<string, unknown> } {
  let finalUrl = url;
  const remainingParams = { ...params };

  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{${key}}`;
    if (finalUrl.includes(placeholder)) {
      finalUrl = finalUrl.replace(new RegExp(placeholder, 'g'), encodeURIComponent(String(value)));
      delete remainingParams[key];
    }
  }

  return { finalUrl, remainingParams };
}

/**
 * Creates AdapterResolvers for a REST API.
 */
export function createRestResolvers(
  clientConfig: RestClientConfig,
  resolversConfig: RestResolverConfig
): AdapterResolvers {
  const fetchClient = clientConfig.fetchFn || globalThis.fetch;
  if (!fetchClient) {
    throw new Error('[RestAdapter] No fetch implementation found. Pass fetchFn in clientConfig if using an old Node version.');
  }

  const resolvers: AdapterResolvers = {};

  for (const [predicateName, handler] of Object.entries(resolversConfig)) {
    resolvers[predicateName] = async (params: Record<string, unknown>) => {
      if (typeof handler === 'function') {
        return handler(params, clientConfig);
      }

      const { method, url, headers, sendParamsAs, transformResponse } = handler;
      const { finalUrl, remainingParams } = fillUrlPlaceholders(url, params);
      
      let fullUrl = clientConfig.baseUrl ? `${clientConfig.baseUrl.replace(/\/$/, '')}/${finalUrl.replace(/^\//, '')}` : finalUrl;
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...clientConfig.defaultHeaders,
        ...headers,
      };

      let body: string | undefined;
      
      const asQuery = sendParamsAs === 'query' || (sendParamsAs === undefined && ['GET', 'DELETE'].includes(method));
      
      if (asQuery) {
        if (Object.keys(remainingParams).length > 0) {
          const queryParams = new URLSearchParams();
          for (const [k, v] of Object.entries(remainingParams)) {
            queryParams.append(k, String(v));
          }
          const separator = fullUrl.includes('?') ? '&' : '?';
          fullUrl += `${separator}${queryParams.toString()}`;
        }
      } else {
        body = JSON.stringify(remainingParams);
      }

      const response = await fetchClient(fullUrl, {
        method,
        headers: reqHeaders,
        body,
      });

      if (!response.ok) {
        throw new Error(`[RestAdapter] HTTP error ${response.status} calling ${method} ${fullUrl}`);
      }

      const contentType = response.headers.get('content-type') || '';
      let data: any;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (transformResponse) {
        return transformResponse(data, response);
      }

      return data;
    };
  }

  return resolvers;
}
