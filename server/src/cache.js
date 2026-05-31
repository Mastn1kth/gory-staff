/**
 * Простая in-memory система кэширования для ускорения работы приложения
 * Кэширует часто запрашиваемые данные: меню, стоп-лист, план зала
 */

class SimpleCache {
  constructor() {
    this.cache = new Map();
    this.ttls = new Map();
  }

  /**
   * Получить значение из кэша
   * @param {string} key - ключ
   * @returns {any|null} - значение или null если не найдено/истекло
   */
  get(key) {
    const ttl = this.ttls.get(key);
    if (ttl && Date.now() > ttl) {
      this.delete(key);
      return null;
    }
    return this.cache.get(key) ?? null;
  }

  /**
   * Установить значение в кэш
   * @param {string} key - ключ
   * @param {any} value - значение
   * @param {number} ttlSeconds - время жизни в секундах (по умолчанию 5 минут)
   */
  set(key, value, ttlSeconds = 300) {
    this.cache.set(key, value);
    if (ttlSeconds > 0) {
      this.ttls.set(key, Date.now() + ttlSeconds * 1000);
    }
  }

  /**
   * Удалить значение из кэша
   * @param {string} key - ключ
   */
  delete(key) {
    this.cache.delete(key);
    this.ttls.delete(key);
  }

  /**
   * Удалить все значения по паттерну
   * @param {string} pattern - паттерн для поиска (например "menu:")
   */
  deletePattern(pattern) {
    const keys = [...this.cache.keys()].filter(key => key.startsWith(pattern));
    keys.forEach(key => this.delete(key));
  }

  /**
   * Очистить весь кэш
   */
  clear() {
    this.cache.clear();
    this.ttls.clear();
  }

  /**
   * Получить размер кэша
   */
  size() {
    return this.cache.size;
  }

  /**
   * Получить или установить значение (если его нет)
   * @param {string} key - ключ
   * @param {Function} fetchFn - функция для получения значения
   * @param {number} ttlSeconds - время жизни в секундах
   */
  async getOrSet(key, fetchFn, ttlSeconds = 300) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFn();
    this.set(key, value, ttlSeconds);
    return value;
  }
}

// Глобальный экземпляр кэша
const cache = new SimpleCache();

// Периодическая очистка истекших записей (каждые 5 минут)
setInterval(() => {
  const now = Date.now();
  for (const [key, ttl] of cache.ttls.entries()) {
    if (now > ttl) {
      cache.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Инвалидация кэша при изменении данных
 */
function invalidateCache(entity) {
  switch (entity) {
    case 'menu':
    case 'menu_items':
    case 'menu_categories':
      cache.deletePattern('menu:');
      break;
    case 'stop_list':
      cache.deletePattern('stop_list:');
      cache.deletePattern('menu:'); // меню зависит от стоп-листа
      break;
    case 'tables':
    case 'floors':
      cache.deletePattern('floor:');
      cache.deletePattern('tables:');
      break;
    case 'users':
      cache.deletePattern('users:');
      break;
    case 'reservations':
      cache.deletePattern('reservations:');
      break;
    default:
      // Для неизвестных сущностей не инвалидируем
      break;
  }
}

/**
 * Middleware для автоматической инвалидации кэша
 */
function cacheInvalidationMiddleware(entity) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      // Инвалидируем кэш после успешного ответа
      if (res.statusCode >= 200 && res.statusCode < 300) {
        invalidateCache(entity);
      }
      return originalJson(data);
    };
    next();
  };
}

module.exports = {
  cache,
  invalidateCache,
  cacheInvalidationMiddleware,
};
