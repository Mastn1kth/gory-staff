const { registerHealthRoutes } = require('./health');
const { registerAuthRoutes } = require('./auth');
const { registerSyncRoutes } = require('./sync');
const { registerGuestRoutes } = require('./guests');
const { registerOAuthRoutes } = require('./oauth');
const { registerFloorRoutes } = require('./floor');
const { registerMenuRoutes } = require('./menu');
const { registerStaffRoutes } = require('./staff');
const { registerAdminRoutes } = require('./admin');
const { registerPushRoutes } = require('./push');
const { registerIikoRoutes } = require('./iiko');
const { registerSocialRoutes } = require('./social');
const { registerReservationReminderRoutes } = require('./reservation-reminders');

function registerAllRoutes(app, deps) {
  registerHealthRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerGuestRoutes(app, deps);
  registerOAuthRoutes(app, deps);
  registerFloorRoutes(app, deps);
  registerMenuRoutes(app, deps);
  registerStaffRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerPushRoutes(app, deps);
  registerIikoRoutes(app, deps);
  registerSocialRoutes(app, deps);
  registerReservationReminderRoutes(app, deps);
}

module.exports = { registerAllRoutes };
