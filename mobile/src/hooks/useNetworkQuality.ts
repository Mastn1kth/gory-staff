/**
 * useNetworkQuality - React Hook для мониторинга качества сети
 */

import { useEffect, useState } from 'react';

import { getGlobalNetworkAdapter, type NetworkQuality, type NetworkConfig } from '../data/networkAdapter';

export function useNetworkQuality(apiUrl: string) {
  const [quality, setQuality] = useState<NetworkQuality>('good');
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [measuring, setMeasuring] = useState(false);

  useEffect(() => {
    const adapter = getGlobalNetworkAdapter();

    // Начальное измерение
    setMeasuring(true);
    adapter.measureQuality(apiUrl).then((q) => {
      setQuality(q);
      setConfig(adapter.getConfig());
      setMeasuring(false);
    });

    // Подписка на изменения
    const unsubscribe = adapter.subscribe((newQuality) => {
      setQuality(newQuality);
      setConfig(adapter.getConfig());
    });

    // Периодические измерения каждые 30 секунд
    const interval = setInterval(() => {
      adapter.measureQuality(apiUrl).then((q) => {
        setQuality(q);
        setConfig(adapter.getConfig());
      });
    }, 30000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [apiUrl]);

  const measure = async () => {
    setMeasuring(true);
    const adapter = getGlobalNetworkAdapter();
    const q = await adapter.measureQuality(apiUrl);
    setQuality(q);
    setConfig(adapter.getConfig());
    setMeasuring(false);
    return q;
  };

  return {
    quality,
    config,
    measuring,
    measure,
  };
}
