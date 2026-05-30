const { createIikoHttpClient, normalizeApiBase } = require('./client');

const UNCATEGORIZED_IIKO_ID = '__iiko_uncategorized__';
const REQUIRED_IIKO_ENV = ['IIKO_ENABLED', 'IIKO_API_LOGIN', 'IIKO_ORGANIZATION_ID'];

function getIikoConfig(env = process.env) {
  const apiLogin = String(env.IIKO_API_LOGIN ?? '').trim();
  const enabledFlag = String(env.IIKO_ENABLED ?? '').trim().toLowerCase();
  const enabled = enabledFlag === 'true' && Boolean(apiLogin);
  const disabledReason =
    enabledFlag !== 'true'
      ? 'IIKO_ENABLED is not true.'
      : !apiLogin
        ? 'IIKO_API_LOGIN is not configured.'
        : null;

  return {
    enabled,
    enabledFlag,
    disabledReason,
    apiBase: normalizeApiBase(env.IIKO_API_BASE),
    apiLogin,
    organizationId: String(env.IIKO_ORGANIZATION_ID ?? '').trim(),
    terminalGroupId: String(env.IIKO_TERMINAL_GROUP_ID ?? '').trim(),
    apiLoginConfigured: Boolean(apiLogin),
  };
}

function trimmedEnvValue(env, name) {
  return String(env[name] ?? '').trim();
}

function missingIikoEnv(env = process.env) {
  return REQUIRED_IIKO_ENV.filter((name) => !trimmedEnvValue(env, name));
}

function maskApiLogin(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length <= 2) return '*'.repeat(text.length);
  if (text.length <= 4) return `${text.slice(0, 1)}***${text.slice(-1)}`;
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function numericLogValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function publicSyncStatus(status) {
  if (!status) return null;
  if (status === 'completed' || status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'disabled') return 'disabled';
  return status;
}

function emptyLastSyncStatus(config) {
  return config.enabled ? null : 'disabled';
}

function formatLastSync(row, config) {
  if (!row) {
    return {
      status: emptyLastSyncStatus(config),
      rawStatus: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      categoriesProcessed: null,
      itemsProcessed: null,
      modifierGroupsProcessed: null,
      modifiersProcessed: null,
      stopListItems: null,
      error: null,
    };
  }

  const categoriesProcessed = numericLogValue(row.categories_created) + numericLogValue(row.categories_updated);
  const itemsProcessed =
    numericLogValue(row.items_created) +
    numericLogValue(row.items_updated) +
    numericLogValue(row.items_archived);
  const modifierGroupsProcessed =
    numericLogValue(row.modifier_groups_created) +
    numericLogValue(row.modifier_groups_updated) +
    numericLogValue(row.modifier_groups_archived);
  const modifiersProcessed =
    numericLogValue(row.modifiers_created) +
    numericLogValue(row.modifiers_updated) +
    numericLogValue(row.modifiers_archived);

  return {
    status: publicSyncStatus(row.status),
    rawStatus: row.status ?? null,
    startedAt: isoTimestamp(row.started_at),
    finishedAt: isoTimestamp(row.finished_at),
    durationMs: row.duration_ms == null ? null : numericLogValue(row.duration_ms),
    categoriesProcessed,
    itemsProcessed,
    modifierGroupsProcessed,
    modifiersProcessed,
    stopListItems: numericLogValue(row.stop_list_items),
    error: row.error_message ?? null,
  };
}

function formatLastOrderSync(row, config) {
  if (!row) {
    return {
      status: emptyLastSyncStatus(config),
      rawStatus: null,
      operation: null,
      orderId: null,
      iikoOrderId: null,
      correlationId: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      itemsSynced: null,
      error: null,
    };
  }

  return {
    status: publicSyncStatus(row.status),
    rawStatus: row.status ?? null,
    operation: row.operation ?? null,
    orderId: row.order_id ?? null,
    iikoOrderId: row.iiko_order_id ?? null,
    correlationId: row.correlation_id ?? null,
    startedAt: isoTimestamp(row.started_at),
    finishedAt: isoTimestamp(row.finished_at),
    durationMs: row.duration_ms == null ? null : numericLogValue(row.duration_ms),
    itemsSynced: numericLogValue(row.items_synced),
    error: row.error_message ?? null,
  };
}

async function withClient(db, callback) {
  if (typeof db.connect === 'function') {
    const client = await db.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }
  return await callback(db);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function firstImage(product) {
  return asArray(product?.imageLinks).find((item) => String(item ?? '').trim()) ?? null;
}

function formatNumber(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `${Math.round(number)} ${unit}`;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function booleanValue(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return defaultValue;
  return text === 'true' || text === '1' || text === 'yes';
}

function pickSizePrice(product) {
  const prices = asArray(product?.sizePrices).filter((item) => item?.price);
  return (
    prices.find((item) => item.price.isIncludedInMenu !== false && item.sizeId == null) ||
    prices.find((item) => item.price.isIncludedInMenu !== false) ||
    prices[0] ||
    null
  );
}

function productPrice(product) {
  const sizePrice = pickSizePrice(product);
  const value = Number(sizePrice?.price?.currentPrice ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

function productIncludedInMenu(product) {
  const sizePrice = pickSizePrice(product);
  if (!sizePrice?.price) return true;
  return sizePrice.price.isIncludedInMenu !== false;
}

function isModifierProduct(product) {
  return String(product?.type ?? '').trim().toLowerCase() === 'modifier';
}

function groupsByIikoId(nomenclature) {
  const map = new Map();
  for (const group of asArray(nomenclature?.groups)) {
    if (group?.id) map.set(String(group.id), group);
  }
  return map;
}

function modifierProductsByIikoId(nomenclature) {
  const map = new Map();
  for (const product of asArray(nomenclature?.products).filter(isModifierProduct)) {
    if (product?.id) map.set(String(product.id), product);
  }
  return map;
}

function categoryFromGroup(group) {
  return {
    iikoId: String(group.id),
    name: compactText(group.name) || 'iiko category',
    sortOrder: Number.isFinite(Number(group.order)) ? Number(group.order) : 0,
    parentGroupId: group.parentGroup ?? null,
    isDeleted: Boolean(group.isDeleted),
  };
}

function categoryFromProductCategory(category, fallbackSortOrder) {
  return {
    iikoId: String(category.id),
    name: compactText(category.name) || 'iiko category',
    sortOrder: fallbackSortOrder,
    parentGroupId: null,
    isDeleted: Boolean(category.isDeleted),
  };
}

function visibleGroups(nomenclature) {
  return asArray(nomenclature?.groups)
    .filter((group) => group?.id && group?.name)
    .filter((group) => group.isGroupModifier !== true)
    .filter((group) => group.isIncludedInMenu !== false)
    .filter((group) => group.isDeleted !== true)
    .map(categoryFromGroup);
}

function fallbackProductCategories(nomenclature, existingCategoryIds) {
  return asArray(nomenclature?.productCategories)
    .filter((category) => category?.id && category?.name)
    .filter((category) => category.isDeleted !== true)
    .filter((category) => !existingCategoryIds.has(String(category.id)))
    .map((category, index) => categoryFromProductCategory(category, 10000 + index));
}

function visibleProducts(nomenclature, categoryIds) {
  return asArray(nomenclature?.products)
    .filter((product) => product?.id && product?.name)
    .filter((product) => !isModifierProduct(product))
    .filter((product) => {
      if (product.parentGroup) return categoryIds.has(String(product.parentGroup));
      if (product.productCategoryId) return categoryIds.has(String(product.productCategoryId));
      return true;
    });
}

function modifierChildProductId(child) {
  return compactText(child?.productId ?? child?.product_id ?? child?.id ?? child?.modifierId);
}

function productModifierGroups(product) {
  const groups = asArray(product?.groupModifiers).map((group, index) => ({
    source: group,
    id: compactText(group?.id ?? group?.modifierGroupId ?? group?.productGroupId) || `direct-${product.id}-${index}`,
    name: compactText(group?.name),
    required: booleanValue(group?.required, Number(group?.minAmount ?? 0) > 0),
    minAmount: integerOrNull(group?.minAmount),
    maxAmount: integerOrNull(group?.maxAmount),
    sortOrder: integerOrNull(group?.order ?? group?.sortOrder) ?? index,
    children: asArray(group?.childModifiers ?? group?.modifiers ?? group?.items),
  }));

  const directModifiers = asArray(product?.modifiers);
  if (directModifiers.length > 0) {
    groups.push({
      source: { modifiers: directModifiers },
      id: `direct-${product.id}`,
      name: 'Modifiers',
      required: false,
      minAmount: null,
      maxAmount: null,
      sortOrder: groups.length,
      children: directModifiers,
    });
  }

  return groups.filter((group) => group.children.some((child) => modifierChildProductId(child)));
}

function modifierGroupPayload(product, group, groupMap) {
  const sourceGroup = groupMap.get(String(group.id));
  return {
    iikoModifierGroupId: String(group.id),
    iikoModifierSchemaId: product.modifierSchemaId ?? null,
    name: group.name || compactText(sourceGroup?.name) || 'Modifiers',
    required: group.required,
    minAmount: group.minAmount,
    maxAmount: group.maxAmount,
    sortOrder: group.sortOrder,
    source: group.source,
  };
}

function modifierPayload(child, modifierProduct, index) {
  const productId = modifierChildProductId(child);
  return {
    iikoModifierProductId: productId,
    name: compactText(child?.name) || compactText(modifierProduct?.name) || productId,
    price: modifierProduct ? productPrice(modifierProduct) : integerOrNull(child?.price) ?? 0,
    minAmount: integerOrNull(child?.minAmount),
    maxAmount: integerOrNull(child?.maxAmount),
    defaultAmount: integerOrNull(child?.defaultAmount),
    freeOfChargeAmount: integerOrNull(child?.freeOfChargeAmount),
    hideIfDefaultAmount: booleanValue(child?.hideIfDefaultAmount),
    sortOrder: integerOrNull(child?.order ?? child?.sortOrder) ?? index,
    status: modifierProduct?.isDeleted === true ? 'archived' : 'active',
    source: child,
  };
}

function productCategoryIikoId(product, categoryIds) {
  if (product.parentGroup && categoryIds.has(String(product.parentGroup))) return String(product.parentGroup);
  if (product.productCategoryId && categoryIds.has(String(product.productCategoryId))) return String(product.productCategoryId);
  return UNCATEGORIZED_IIKO_ID;
}

function itemStatus(product, stoppedProductIds) {
  if (product.isDeleted === true) return 'archived';
  if (stoppedProductIds.has(String(product.id))) return 'stop';
  if (!productIncludedInMenu(product)) return 'unavailable';
  return 'available';
}

function itemPayload(product, categoryId, stoppedProductIds) {
  const sizePrice = pickSizePrice(product);
  const description = compactText(product.description ?? product.additionalInfo);
  return {
    name: compactText(product.name) || 'iiko item',
    categoryId,
    price: productPrice(product),
    photoUrl: firstImage(product),
    composition: description || '',
    weight: formatNumber(product.weight, product.measureUnit || 'g'),
    calories: formatNumber(product.energyFullAmount ?? product.energyAmount, 'kcal'),
    description,
    status: itemStatus(product, stoppedProductIds),
    iikoId: String(product.id),
    iikoGroupId: product.parentGroup ?? null,
    iikoProductCategoryId: product.productCategoryId ?? null,
    iikoSizeId: sizePrice?.sizeId ?? null,
    iikoModifierSchemaId: product.modifierSchemaId ?? null,
    iikoRawType: product.type ?? null,
    iikoIsDeleted: Boolean(product.isDeleted),
  };
}

async function loadCategoriesByIikoId(client) {
  const result = await client.query('SELECT id, iiko_id FROM menu_categories WHERE iiko_id IS NOT NULL');
  return new Map(result.rows.map((row) => [row.iiko_id, row.id]));
}

async function ensureUncategorizedCategory(client, randomUUID, now) {
  const existing = await client.query('SELECT id FROM menu_categories WHERE iiko_id = $1 LIMIT 1', [UNCATEGORIZED_IIKO_ID]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_categories
       (id, name, sort_order, iiko_id, iiko_parent_group_id, iiko_is_deleted, iiko_last_seen_at)
     VALUES ($1, $2, $3, $4, NULL, FALSE, $5)`,
    [id, 'iiko uncategorized', 99999, UNCATEGORIZED_IIKO_ID, now],
  );
  return id;
}

async function upsertCategory(client, category, randomUUID, now) {
  const existing = await client.query('SELECT id FROM menu_categories WHERE iiko_id = $1 LIMIT 1', [category.iikoId]);
  if (existing.rows[0]) {
    await client.query(
      `UPDATE menu_categories
       SET name = $2,
           sort_order = $3,
           iiko_parent_group_id = $4,
           iiko_is_deleted = $5,
           iiko_last_seen_at = $6
       WHERE id = $1`,
      [existing.rows[0].id, category.name, category.sortOrder, category.parentGroupId, category.isDeleted, now],
    );
    return { id: existing.rows[0].id, created: false };
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_categories
       (id, name, sort_order, iiko_id, iiko_parent_group_id, iiko_is_deleted, iiko_last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, category.name, category.sortOrder, category.iikoId, category.parentGroupId, category.isDeleted, now],
  );
  return { id, created: true };
}

async function upsertItem(client, payload, randomUUID, now) {
  const existing = await client.query('SELECT id FROM menu_items WHERE iiko_id = $1 LIMIT 1', [payload.iikoId]);
  if (existing.rows[0]) {
    await client.query(
      `UPDATE menu_items
       SET name = $2,
           category_id = $3,
           price = $4,
           photo_url = COALESCE($5, photo_url),
           weight = COALESCE($6, weight),
           calories = COALESCE($7, calories),
           description = COALESCE($8, description),
           status = $9,
           updated_at = NOW(),
           version = version + 1,
           iiko_group_id = $10,
           iiko_product_category_id = $11,
           iiko_size_id = $12,
           iiko_modifier_schema_id = $13,
           iiko_raw_type = $14,
           iiko_is_deleted = $15,
           iiko_last_seen_at = $16,
           archived_at = CASE WHEN $9 = 'archived' THEN COALESCE(archived_at, NOW()) ELSE NULL END
       WHERE id = $1`,
      [
        existing.rows[0].id,
        payload.name,
        payload.categoryId,
        payload.price,
        payload.photoUrl,
        payload.weight,
        payload.calories,
        payload.description,
        payload.status,
        payload.iikoGroupId,
        payload.iikoProductCategoryId,
        payload.iikoSizeId,
        payload.iikoModifierSchemaId,
        payload.iikoRawType,
        payload.iikoIsDeleted,
        now,
      ],
    );
    return { id: existing.rows[0].id, created: false };
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_items
       (id, name, category_id, price, photo_url, composition, weight, calories, description,
        item_type, is_bar, is_kitchen, status, updated_at,
        iiko_id, iiko_group_id, iiko_product_category_id, iiko_size_id, iiko_modifier_schema_id,
        iiko_raw_type, iiko_is_deleted, iiko_last_seen_at, archived_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        'food', FALSE, TRUE, $10, NOW(),
        $11, $12, $13, $14, $15,
        $16, $17, $18, CASE WHEN $10 = 'archived' THEN NOW() ELSE NULL END)`,
    [
      id,
      payload.name,
      payload.categoryId,
      payload.price,
      payload.photoUrl,
      payload.composition,
      payload.weight,
      payload.calories,
      payload.description,
      payload.status,
      payload.iikoId,
      payload.iikoGroupId,
      payload.iikoProductCategoryId,
      payload.iikoSizeId,
      payload.iikoModifierSchemaId,
      payload.iikoRawType,
      payload.iikoIsDeleted,
      now,
    ],
  );
  return { id, created: true };
}

async function upsertModifierGroup(client, menuItemId, payload, randomUUID, now) {
  const existing = await client.query(
    `SELECT id
     FROM menu_item_modifier_groups
     WHERE menu_item_id = $1 AND iiko_modifier_group_id = $2
     LIMIT 1`,
    [menuItemId, payload.iikoModifierGroupId],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE menu_item_modifier_groups
       SET name = $3,
           iiko_modifier_schema_id = $4,
           required = $5,
           min_amount = $6,
           max_amount = $7,
           sort_order = $8,
           status = 'active',
           iiko_payload_json = $9::jsonb,
           iiko_last_seen_at = $10,
           updated_at = NOW()
       WHERE id = $1`,
      [
        existing.rows[0].id,
        menuItemId,
        payload.name,
        payload.iikoModifierSchemaId,
        payload.required,
        payload.minAmount,
        payload.maxAmount,
        payload.sortOrder,
        JSON.stringify(payload.source ?? {}),
        now,
      ],
    );
    return { id: existing.rows[0].id, created: false };
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_item_modifier_groups
       (id, menu_item_id, name, iiko_modifier_group_id, iiko_modifier_schema_id, required,
        min_amount, max_amount, sort_order, status, iiko_payload_json, iiko_last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10::jsonb,$11)`,
    [
      id,
      menuItemId,
      payload.name,
      payload.iikoModifierGroupId,
      payload.iikoModifierSchemaId,
      payload.required,
      payload.minAmount,
      payload.maxAmount,
      payload.sortOrder,
      JSON.stringify(payload.source ?? {}),
      now,
    ],
  );
  return { id, created: true };
}

async function upsertModifierItem(client, modifierGroupId, payload, randomUUID, now) {
  const existing = await client.query(
    `SELECT id
     FROM menu_item_modifiers
     WHERE modifier_group_id = $1 AND iiko_modifier_product_id = $2
     LIMIT 1`,
    [modifierGroupId, payload.iikoModifierProductId],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE menu_item_modifiers
       SET name = $3,
           price = $4,
           min_amount = $5,
           max_amount = $6,
           default_amount = $7,
           free_of_charge_amount = $8,
           hide_if_default_amount = $9,
           sort_order = $10,
           status = $11,
           iiko_payload_json = $12::jsonb,
           iiko_last_seen_at = $13,
           updated_at = NOW()
       WHERE id = $1`,
      [
        existing.rows[0].id,
        modifierGroupId,
        payload.name,
        payload.price,
        payload.minAmount,
        payload.maxAmount,
        payload.defaultAmount,
        payload.freeOfChargeAmount,
        payload.hideIfDefaultAmount,
        payload.sortOrder,
        payload.status,
        JSON.stringify(payload.source ?? {}),
        now,
      ],
    );
    return { id: existing.rows[0].id, created: false };
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO menu_item_modifiers
       (id, modifier_group_id, iiko_modifier_product_id, name, price, min_amount, max_amount,
        default_amount, free_of_charge_amount, hide_if_default_amount, sort_order, status,
        iiko_payload_json, iiko_last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
    [
      id,
      modifierGroupId,
      payload.iikoModifierProductId,
      payload.name,
      payload.price,
      payload.minAmount,
      payload.maxAmount,
      payload.defaultAmount,
      payload.freeOfChargeAmount,
      payload.hideIfDefaultAmount,
      payload.sortOrder,
      payload.status,
      JSON.stringify(payload.source ?? {}),
      now,
    ],
  );
  return { id, created: true };
}

async function archiveMissingModifierRows(client, seenGroupIds, seenModifierIds) {
  const modifierFilter = seenModifierIds.length > 0
    ? `AND id NOT IN (${seenModifierIds.map((_, index) => `$${index + 1}`).join(', ')})`
    : '';
  const modifierArchived =
    await client.query(
      `UPDATE menu_item_modifiers
       SET status = 'archived',
           updated_at = NOW()
       WHERE status <> 'archived'
         ${modifierFilter}
       RETURNING id`,
      seenModifierIds,
    );

  const groupFilter = seenGroupIds.length > 0
    ? `AND id NOT IN (${seenGroupIds.map((_, index) => `$${index + 1}`).join(', ')})`
    : '';
  const groupArchived =
    await client.query(
      `UPDATE menu_item_modifier_groups
       SET status = 'archived',
           updated_at = NOW()
       WHERE status <> 'archived'
         ${groupFilter}
       RETURNING id`,
      seenGroupIds,
    );

  return {
    groups: groupArchived.rows?.length ?? groupArchived.rowCount ?? 0,
    items: modifierArchived.rows?.length ?? modifierArchived.rowCount ?? 0,
  };
}

async function syncProductModifiers(client, product, menuItemId, context, randomUUID, now) {
  const counts = {
    groups: { created: 0, updated: 0 },
    items: { created: 0, updated: 0 },
  };
  const seenGroupIds = [];
  const seenModifierIds = [];

  for (const group of productModifierGroups(product)) {
    const savedGroup = await upsertModifierGroup(
      client,
      menuItemId,
      modifierGroupPayload(product, group, context.groupMap),
      randomUUID,
      now,
    );
    seenGroupIds.push(savedGroup.id);
    counts.groups[savedGroup.created ? 'created' : 'updated'] += 1;

    for (const [index, child] of group.children.entries()) {
      const productId = modifierChildProductId(child);
      if (!productId) continue;
      const modifierProduct = context.modifierProductMap.get(productId);
      const savedModifier = await upsertModifierItem(
        client,
        savedGroup.id,
        modifierPayload(child, modifierProduct, index),
        randomUUID,
        now,
      );
      seenModifierIds.push(savedModifier.id);
      counts.items[savedModifier.created ? 'created' : 'updated'] += 1;
    }
  }

  return { counts, seenGroupIds, seenModifierIds };
}

function extractStoppedProducts(stopLists, organizationId, terminalGroupId = '') {
  const products = new Map();
  for (const wrapper of asArray(stopLists?.terminalGroupStopLists)) {
    if (wrapper.organizationId && String(wrapper.organizationId) !== String(organizationId)) continue;
    for (const terminalList of asArray(wrapper.items)) {
      if (terminalGroupId && terminalList.terminalGroupId && String(terminalList.terminalGroupId) !== String(terminalGroupId)) continue;
      for (const item of asArray(terminalList.items)) {
        if (!item?.productId) continue;
        const productId = String(item.productId);
        products.set(productId, {
          productId,
          sizeId: item.sizeId ?? null,
          terminalGroupId: (terminalList.terminalGroupId ?? terminalGroupId) || null,
          balance: item.balance ?? null,
        });
      }
    }
  }
  return products;
}

async function syncStopListRows(client, stoppedProducts, now, randomUUID) {
  let count = 0;
  for (const stopped of stoppedProducts.values()) {
    const item = await client.query('SELECT id, name FROM menu_items WHERE iiko_id = $1 LIMIT 1', [stopped.productId]);
    if (!item.rows[0]) continue;
    const existing = await client.query(
      `SELECT id
       FROM stop_list
       WHERE source = 'iiko'
         AND iiko_product_id = $1
         AND COALESCE(iiko_size_id, '') = COALESCE($2, '')
         AND COALESCE(iiko_terminal_group_id, '') = COALESCE($3, '')
       LIMIT 1`,
      [stopped.productId, stopped.sizeId, stopped.terminalGroupId],
    );
    const comment = stopped.balance == null ? 'Imported from iiko stop-list.' : `Imported from iiko stop-list. Balance: ${stopped.balance}.`;
    if (existing.rows[0]) {
      await client.query(
        `UPDATE stop_list
         SET menu_item_id = $2,
             reason = 'iiko stop-list',
             status = 'out',
             comment = $3,
             updated_at = NOW(),
             iiko_last_seen_at = $4
         WHERE id = $1`,
        [existing.rows[0].id, item.rows[0].id, comment, now],
      );
    } else {
      await client.query(
        `INSERT INTO stop_list
           (id, menu_item_id, reason, status, added_by, created_at, expected_return_at, comment,
            source, iiko_product_id, iiko_size_id, iiko_terminal_group_id, iiko_last_seen_at)
         VALUES ($1, $2, 'iiko stop-list', 'out', NULL, NOW(), NULL, $3, 'iiko', $4, $5, $6, $7)`,
        [randomUUID(), item.rows[0].id, comment, stopped.productId, stopped.sizeId, stopped.terminalGroupId, now],
      );
    }
    count += 1;
  }

  await client.query(
    `UPDATE stop_list
     SET status = 'available',
         updated_at = NOW()
     WHERE source = 'iiko'
       AND status <> 'available'
       AND (iiko_last_seen_at IS NULL OR iiko_last_seen_at < $1)`,
    [now],
  );

  return count;
}

async function insertSyncLog(client, result, randomUUID) {
  await client.query(
    `INSERT INTO iiko_sync_log
       (id, status, started_at, finished_at, duration_ms,
        categories_created, categories_updated, items_created, items_updated, items_archived,
        stop_list_items, error_message,
        modifier_groups_created, modifier_groups_updated, modifier_groups_archived,
        modifiers_created, modifiers_updated, modifiers_archived)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      randomUUID(),
      result.status,
      result.started_at,
      result.finished_at,
      result.duration_ms,
      result.categories.created,
      result.categories.updated,
      result.items.created,
      result.items.updated,
      result.items.archived,
      result.stop_list.items,
      result.error ?? null,
      result.modifiers.groups.created,
      result.modifiers.groups.updated,
      result.modifiers.groups.archived,
      result.modifiers.items.created,
      result.modifiers.items.updated,
      result.modifiers.items.archived,
    ],
  );
}

function buildResult(status, startedAt, data = {}) {
  const finishedAt = new Date();
  return {
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    categories: { created: 0, updated: 0, ...(data.categories ?? {}) },
    items: { created: 0, updated: 0, archived: 0, ...(data.items ?? {}) },
    modifiers: {
      groups: { created: 0, updated: 0, archived: 0, ...(data.modifiers?.groups ?? {}) },
      items: { created: 0, updated: 0, archived: 0, ...(data.modifiers?.items ?? {}) },
    },
    stop_list: { items: 0, ...(data.stop_list ?? {}) },
    ...(data.error ? { error: data.error } : {}),
    ...(data.disabled_reason ? { disabled_reason: data.disabled_reason } : {}),
  };
}

async function syncIikoMenu(options = {}) {
  const startedAt = new Date();
  const env = options.env ?? process.env;
  const config = getIikoConfig(env);
  const randomUUID = options.randomUUID;
  if (typeof randomUUID !== 'function') throw new Error('randomUUID is required for iiko sync.');

  if (!config.enabled) {
    return buildResult('disabled', startedAt, { disabled_reason: config.disabledReason });
  }
  if (!config.organizationId) {
    const result = buildResult('failed', startedAt, { error: 'IIKO_ORGANIZATION_ID is not configured.' });
    if (options.db) {
      await withClient(options.db, (client) => insertSyncLog(client, result, randomUUID));
    }
    return result;
  }

  const iikoClient = options.iikoClient || createIikoHttpClient(config, options);
  try {
    const [nomenclature, stopLists] = await Promise.all([
      iikoClient.fetchNomenclature(config.organizationId),
      typeof iikoClient.fetchStopLists === 'function'
        ? iikoClient.fetchStopLists(config.organizationId, config.terminalGroupId || null)
        : Promise.resolve({ terminalGroupStopLists: [] }),
    ]);

    return await withClient(options.db, async (client) => {
      await client.query('BEGIN');
      try {
        const now = startedAt;
        const stoppedProducts = extractStoppedProducts(stopLists, config.organizationId, config.terminalGroupId);
        const modifierContext = {
          groupMap: groupsByIikoId(nomenclature),
          modifierProductMap: modifierProductsByIikoId(nomenclature),
        };
        const categories = visibleGroups(nomenclature);
        const categoryIds = new Set(categories.map((category) => category.iikoId));
        categories.push(...fallbackProductCategories(nomenclature, categoryIds));
        for (const category of categories) categoryIds.add(category.iikoId);

        const counts = {
          categories: { created: 0, updated: 0 },
          items: { created: 0, updated: 0, archived: 0 },
          modifiers: {
            groups: { created: 0, updated: 0, archived: 0 },
            items: { created: 0, updated: 0, archived: 0 },
          },
          stop_list: { items: 0 },
        };

        for (const category of categories) {
          const saved = await upsertCategory(client, category, randomUUID, now);
          counts.categories[saved.created ? 'created' : 'updated'] += 1;
        }

        let categoryByIikoId = await loadCategoriesByIikoId(client);
        const products = visibleProducts(nomenclature, categoryIds);
        const syncedProductIds = products.map((product) => String(product.id));
        const seenModifierGroupIds = [];
        const seenModifierIds = [];
        for (const product of products) {
          const categoryIikoId = productCategoryIikoId(product, categoryIds);
          let categoryId = categoryByIikoId.get(categoryIikoId);
          if (!categoryId) {
            categoryId = await ensureUncategorizedCategory(client, randomUUID, now);
            categoryByIikoId = await loadCategoriesByIikoId(client);
          }
          const saved = await upsertItem(client, itemPayload(product, categoryId, stoppedProducts), randomUUID, now);
          counts.items[saved.created ? 'created' : 'updated'] += 1;
          const modifierSync = await syncProductModifiers(client, product, saved.id, modifierContext, randomUUID, now);
          counts.modifiers.groups.created += modifierSync.counts.groups.created;
          counts.modifiers.groups.updated += modifierSync.counts.groups.updated;
          counts.modifiers.items.created += modifierSync.counts.items.created;
          counts.modifiers.items.updated += modifierSync.counts.items.updated;
          seenModifierGroupIds.push(...modifierSync.seenGroupIds);
          seenModifierIds.push(...modifierSync.seenModifierIds);
        }

        const archivedModifiers = await archiveMissingModifierRows(client, seenModifierGroupIds, seenModifierIds);
        counts.modifiers.groups.archived = archivedModifiers.groups;
        counts.modifiers.items.archived = archivedModifiers.items;

        const archiveParams = [UNCATEGORIZED_IIKO_ID, ...syncedProductIds];
        const syncedProductFilter =
          syncedProductIds.length > 0
            ? `AND iiko_id NOT IN (${syncedProductIds.map((_, index) => `$${index + 2}`).join(', ')})`
            : '';
        const archived = await client.query(
          `UPDATE menu_items
           SET status = 'archived',
               archived_at = COALESCE(archived_at, NOW()),
               updated_at = NOW(),
               version = version + 1
           WHERE iiko_id <> $1
             AND status <> 'archived'
             ${syncedProductFilter}
           RETURNING id`,
          archiveParams,
        );
        counts.items.archived = archived.rows?.length ?? archived.rowCount ?? 0;
        counts.stop_list.items = await syncStopListRows(client, stoppedProducts, now, randomUUID);

        const result = buildResult('completed', startedAt, counts);
        await insertSyncLog(client, result, randomUUID);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } catch (error) {
    const result = buildResult('failed', startedAt, { error: error.message });
    if (options.db) {
      await withClient(options.db, (client) => insertSyncLog(client, result, randomUUID));
    }
    options.logger?.warn?.('iiko sync failed:', error.message);
    return result;
  }
}

async function getIikoStatus(db, env = process.env) {
  const config = getIikoConfig(env);
  const missingEnv = missingIikoEnv(env);
  const { lastSync, lastOrderSync } = await withClient(db, async (client) => {
    const [menuResult, orderResult] = await Promise.all([
      client.query('SELECT * FROM iiko_sync_log ORDER BY finished_at DESC LIMIT 1'),
      client.query('SELECT * FROM iiko_order_sync_log ORDER BY finished_at DESC LIMIT 1'),
    ]);
    return {
      lastSync: menuResult.rows[0] ?? null,
      lastOrderSync: orderResult.rows[0] ?? null,
    };
  });
  const formattedLastSync = formatLastSync(lastSync, config);
  const formattedLastOrderSync = formatLastOrderSync(lastOrderSync, config);

  return {
    enabled: config.enabled,
    disabled_reason: config.enabled ? null : config.disabledReason,
    disabledReason: config.enabled ? null : config.disabledReason,
    api_base: config.apiBase,
    api_login_configured: config.apiLoginConfigured,
    organization_id_configured: Boolean(config.organizationId),
    terminal_group_id_configured: Boolean(config.terminalGroupId),
    env: {
      ok: missingEnv.length === 0 && config.enabled,
      missing: missingEnv,
      apiBase: config.apiBase,
      apiLoginConfigured: config.apiLoginConfigured,
      apiLoginMasked: maskApiLogin(config.apiLogin),
      organizationId: config.organizationId || null,
      organizationIdConfigured: Boolean(config.organizationId),
      terminalGroupId: config.terminalGroupId || null,
      terminalGroupIdConfigured: Boolean(config.terminalGroupId),
      webhookSecretConfigured: Boolean(trimmedEnvValue(env, 'IIKO_WEBHOOK_SECRET')),
    },
    endpoints: {
      access_token: '/api/1/access_token',
      organizations: '/api/1/organizations',
      nomenclature: '/api/1/nomenclature',
      stop_lists: '/api/1/stop_lists',
      terminal_groups: '/api/1/terminal_groups',
      payment_types: '/api/1/payment_types',
      order_create: '/api/1/order/create',
      order_add_items: '/api/1/order/add_items',
      order_by_id: '/api/1/order/by_id',
      order_close: '/api/1/order/close',
      commands_status: '/api/1/commands/status',
      local_order_sync: '/iiko/sync/orders/:orderId',
      local_order_status_sync: '/iiko/sync/orders/:orderId/status',
      local_open_order_status_sync: '/iiko/sync/orders/statuses',
    },
    webhooks: {
      payment_paid: '/iiko/events/payment-paid',
      payment_paid_alias: '/iiko/webhooks/payment-paid',
      secret_configured: Boolean(trimmedEnvValue(env, 'IIKO_WEBHOOK_SECRET')),
    },
    orderSync: {
      enabled: config.enabled && Boolean(config.organizationId) && Boolean(config.terminalGroupId),
      disabled_reason:
        config.enabled && !config.terminalGroupId
          ? 'IIKO_TERMINAL_GROUP_ID is not configured.'
          : config.enabled
            ? null
            : config.disabledReason,
      lastSync: formattedLastOrderSync,
      last_sync: formattedLastOrderSync,
    },
    lastSync: formattedLastSync,
    last_sync: formattedLastSync,
  };
}

module.exports = {
  getIikoConfig,
  getIikoStatus,
  syncIikoMenu,
  extractStoppedProducts,
};
