/**
 * useSmartRetry - React Hook для использования Smart Retry Strategy
 */

import { useCallback } from 'react';

import { getGlobalRetryStrategy, type RetryContext } from '../data/smartRetry';

export function useSmartRetry() {
  const retryStrategy = getGlobalRetryStrategy();

  const executeWithRetry = useCallback(
    async <T>(fn: () => Promise<T>, context: RetryContext): Promise<T> => {
      return retryStrategy.executeWithRetry(fn, context);
    },
    [retryStrategy]
  );

  const getStats = useCallback(() => {
    return retryStrategy.getStats();
  }, [retryStrategy]);

  const clearStats = useCallback(() => {
    retryStrategy.clearStats();
  }, [retryStrategy]);

  return {
    executeWithRetry,
    getStats,
    clearStats,
  };
}
