const { requireExpectedVersion, sendVersionConflict } = require('../concurrency');

function isMobileSyncRequest(req) {
  const appHeader = String(req.get('x-gory-app') ?? '').toLowerCase();
  return appHeader === 'mobile' || req.query?.mobile === '1';
}

function registerSyncRoutes(app, deps) {
  const { asyncHandler, authMiddleware, getSnapshot, targetGroupsForRole, query, emitChange, randomUUID } = deps;

  app.patch(
    '/shift-checklist/:id',
    authMiddleware,
    asyncHandler(async (req, res) => {
      const groups = targetGroupsForRole(req.user.role);
      const isDone = Boolean(req.body?.is_done);
      const current = (
        await query(
          `SELECT *
           FROM shift_checklist_items
           WHERE id = $1
             AND target_role = ANY($2::text[])`,
          [req.params.id, groups],
        )
      ).rows[0];
      if (!current) {
        res.status(404).json({ error: 'Запись стоп-листа не найдена.' });
        return;
      }
      const expectedVersion = requireExpectedVersion(req, res, current);
      if (!expectedVersion) return;
      const result = await query(
        `UPDATE shift_checklist_items
         SET is_done = $2,
             done_by = CASE WHEN $2 THEN $3 ELSE NULL END,
             done_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1
           AND target_role = ANY($4::text[])
           AND version = $5
         RETURNING *`,
        [req.params.id, isDone, req.user.id, groups, expectedVersion],
      );

      if (!result.rows[0]) {
        const latest = (await query('SELECT * FROM shift_checklist_items WHERE id = $1', [req.params.id])).rows[0];
        sendVersionConflict(res, latest);
        return;
      }

      emitChange('shift_checklist', 'updated', result.rows[0]);
      res.json(result.rows[0]);
    }),
  );

  app.get(
    '/sync',
    authMiddleware,
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store, no-transform');
      res.json(await getSnapshot(req.user, { mobile: isMobileSyncRequest(req) }));
    }),
  );
}

module.exports = { registerSyncRoutes };
