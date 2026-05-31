const { createIikoHttpClient } = require('./client');
const { normalizeIikoOrderEvent, processIikoOrderEvent, publicIikoExternalOrder } = require('./orderEvents');
const { syncGuestOrderToIiko, syncIikoOrderStatus, syncOpenIikoOrderStatuses } = require('./orderSync');
const { normalizePaymentEvent, processIikoPaymentEvent } = require('./paymentEvents');
const { iikoOrderStatusSyncIntervalMs, startIikoOrderStatusSyncScheduler } = require('./scheduler');
const { iikoStaffSyncIntervalMs, startIikoStaffSyncScheduler } = require('./staffScheduler');
const { extractStoppedProducts, getIikoConfig, getIikoStatus, syncIikoMenu } = require('./sync');
const { syncIikoStaff, getIikoStaffSyncStatus } = require('./staffSync');

module.exports = {
  createIikoHttpClient,
  extractStoppedProducts,
  getIikoConfig,
  getIikoStatus,
  getIikoStaffSyncStatus,
  normalizeIikoOrderEvent,
  normalizePaymentEvent,
  processIikoOrderEvent,
  processIikoPaymentEvent,
  publicIikoExternalOrder,
  iikoOrderStatusSyncIntervalMs,
  startIikoOrderStatusSyncScheduler,
  iikoStaffSyncIntervalMs,
  startIikoStaffSyncScheduler,
  syncGuestOrderToIiko,
  syncIikoOrderStatus,
  syncOpenIikoOrderStatuses,
  syncIikoMenu,
  syncIikoStaff,
};
