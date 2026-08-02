import { AsyncLocalStorage } from "node:async_hooks";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

import { parseProviderProxyUrl } from "@/lib/providerProxy";

interface ProviderProxyFetchState {
  proxyUrlStorage: AsyncLocalStorage<string>;
  dispatchers: Map<string, Dispatcher>;
  directFetch: typeof globalThis.fetch;
  providerAwareFetch: typeof globalThis.fetch;
}

const STATE_KEY = Symbol.for("dyad.providerProxyFetch");
const globalState = globalThis as typeof globalThis &
  Record<PropertyKey, unknown>;

function createProviderProxyFetchState(): ProviderProxyFetchState {
  const state = {
    proxyUrlStorage: new AsyncLocalStorage<string>(),
    dispatchers: new Map<string, Dispatcher>(),
    directFetch: globalThis.fetch.bind(globalThis),
  } as ProviderProxyFetchState;
  state.providerAwareFetch = (input, init) =>
    providerAwareFetch(state, input, init);
  return state;
}

const state =
  (globalState[STATE_KEY] as ProviderProxyFetchState | undefined) ??
  createProviderProxyFetchState();
globalState[STATE_KEY] = state;

function getProxyDispatcher(
  state: ProviderProxyFetchState,
  proxyUrl: string,
): Dispatcher {
  let dispatcher = state.dispatchers.get(proxyUrl);
  if (dispatcher) {
    return dispatcher;
  }

  const url = parseProviderProxyUrl(proxyUrl);
  dispatcher = new ProxyAgent({ uri: url.toString() });
  state.dispatchers.set(proxyUrl, dispatcher);
  return dispatcher;
}

async function providerAwareFetch(
  state: ProviderProxyFetchState,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const proxyUrl = state.proxyUrlStorage.getStore();
  if (!proxyUrl) {
    return state.directFetch(input, init);
  }

  return undiciFetch(
    input as string | URL,
    {
      ...init,
      dispatcher: getProxyDispatcher(state, proxyUrl),
    } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>;
}

if (globalThis.fetch !== state.providerAwareFetch) {
  globalThis.fetch = state.providerAwareFetch;
}

export function runWithProviderProxy<T>(
  proxyUrl: string | undefined,
  callback: () => T,
): T {
  if (!proxyUrl) {
    return callback();
  }
  parseProviderProxyUrl(proxyUrl);
  return state.proxyUrlStorage.run(proxyUrl, callback);
}

export function fetchWithProviderProxy(
  proxyUrl: string,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  return runWithProviderProxy(proxyUrl, () =>
    state.providerAwareFetch(input, init),
  );
}
