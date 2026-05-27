const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { roleDefinitions } = require('./permissions');

const emptyRestaurantSourceData = {
  categories: [],
  menuItems: [],
  floors: [],
  tables: [],
};

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableName(name) {
  return name === 'tables' ? '"tables"' : quoteIdentifier(name);
}

async function upsertRows(client, table, rows, conflictKey = 'id') {
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((_, index) => `$${index + 1}`).join(', ');
    const updates = columns
      .filter((column) => column !== conflictKey)
      .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
      .join(', ');

    await client.query(
      `INSERT INTO ${tableName(table)} (${columns.map(quoteIdentifier).join(', ')})
       VALUES (${values})
       ON CONFLICT (${quoteIdentifier(conflictKey)})
       DO UPDATE SET ${updates}`,
      columns.map((column) => serializeValue(row[column])),
    );
  }
}

function serializeValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object' && !(value instanceof Date))) {
    return JSON.stringify(value);
  }
  return value;
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isoDateTime(offsetDays, time) {
  return `${isoDate(offsetDays)}T${time}:00+03:00`;
}

function requiredEnv(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} must be set before seeding demo users.`);
  }
  return value;
}

function requiredPassword(name) {
  const value = requiredEnv(name);
  if (value.length < 8) {
    throw new Error(`${name} must be at least 8 characters.`);
  }
  return value;
}

function loadRestaurantSourceData() {
  const sourcePath =
    process.env.RESTAURANT_SOURCE_DATA_PATH ||
    path.join(__dirname, 'restaurantSourceData.json');

  if (!fs.existsSync(sourcePath)) {
    return emptyRestaurantSourceData;
  }

  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  return {
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    menuItems: Array.isArray(parsed.menuItems) ? parsed.menuItems : [],
    floors: Array.isArray(parsed.floors) ? parsed.floors : [],
    tables: Array.isArray(parsed.tables) ? parsed.tables : [],
  };
}

async function seedRestaurantSourceData(client) {
  const restaurantSourceData = loadRestaurantSourceData();
  if (
    restaurantSourceData.categories.length === 0 &&
    restaurantSourceData.menuItems.length === 0 &&
    restaurantSourceData.floors.length === 0 &&
    restaurantSourceData.tables.length === 0
  ) {
    return;
  }

  const referencedUserIds = [
    ...new Set([
      ...restaurantSourceData.menuItems.map((item) => item.updated_by).filter(Boolean),
      ...restaurantSourceData.tables.map((table) => table.current_waiter_id).filter(Boolean),
    ]),
  ];
  const existingUsers = new Set();
  if (referencedUserIds.length > 0) {
    const placeholders = referencedUserIds.map((_, index) => `$${index + 1}`).join(', ');
    const users = await client.query(`SELECT id FROM users WHERE id IN (${placeholders})`, referencedUserIds);
    for (const user of users.rows) {
      existingUsers.add(user.id);
    }
  }

  const menuItems = restaurantSourceData.menuItems.map((item) => {
    if (item.updated_by && !existingUsers.has(item.updated_by)) {
      return { ...item, updated_by: null };
    }
    return item;
  });
  const tables = restaurantSourceData.tables.map((table) => {
    if (table.current_waiter_id && !existingUsers.has(table.current_waiter_id)) {
      return { ...table, current_waiter_id: null };
    }
    return table;
  });

  await upsertRows(client, 'menu_categories', restaurantSourceData.categories);
  await upsertRows(client, 'menu_items', menuItems);
  await upsertRows(client, 'floors', restaurantSourceData.floors);
  await upsertRows(client, 'tables', tables);
}

async function seedRoles(client) {
  const roles = Object.values(roleDefinitions).map((role) => ({
    id: role.id,
    name: role.name,
    permissions: role.permissions,
  }));

  await upsertRows(client, 'roles', roles);
}

async function backfillConfiguredPasswords(client) {
  const managerLogin = String(process.env.INITIAL_MANAGER_LOGIN ?? '').trim();
  const managerPassword = String(process.env.INITIAL_MANAGER_PASSWORD ?? '').trim();
  const staffPassword = String(process.env.DEMO_STAFF_PASSWORD ?? '').trim();
  if (!managerPassword && !staffPassword) return;

  const result = await client.query('SELECT id, login, password_hash, password_plain FROM users');
  for (const user of result.rows) {
    if (user.password_plain) continue;

    let visiblePassword = null;
    if (managerLogin && managerPassword && user.login === managerLogin && bcrypt.compareSync(managerPassword, user.password_hash)) {
      visiblePassword = managerPassword;
    } else if (staffPassword && bcrypt.compareSync(staffPassword, user.password_hash)) {
      visiblePassword = staffPassword;
    }

    if (visiblePassword) {
      await client.query('UPDATE users SET password_plain = $2 WHERE id = $1', [user.id, visiblePassword]);
    }
  }
}

async function seedDatabase(client) {
  await seedRoles(client);
  const managerLogin = requiredEnv('INITIAL_MANAGER_LOGIN');
  const managerPassword = requiredPassword('INITIAL_MANAGER_PASSWORD');
  const staffPassword = requiredPassword('DEMO_STAFF_PASSWORD');
  const managerHash = bcrypt.hashSync(managerPassword, 10);
  const staffHash = bcrypt.hashSync(staffPassword, 10);

  const users = [
    {
      id: 'u-owner',
      name: 'Владелец Ресторана',
      phone: '+7 900 100-10-00',
      login: 'owner',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'owner',
      position: 'Владелец',
      status: 'off_shift',
      photo_url: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=300&q=80',
      comment: 'Смотрит прибыль, клиентов, персонал и график.',
    },
    {
      id: 'u-admin',
      name: 'Георгий Казбеков',
      phone: '+7 900 100-10-01',
      login: managerLogin,
      password_hash: managerHash,
      password_plain: managerPassword,
      role: 'manager',
      position: 'Управляющий',
      status: 'on_shift',
      photo_url: 'https://images.unsplash.com/photo-1556157382-97eda2d62296?auto=format&fit=crop&w=300&q=80',
      comment: 'Отвечает за зал, финансы, персонал и развитие ресторана.',
    },
    {
      id: 'u-administrator',
      name: 'Алена Мирзоева',
      phone: '+7 900 100-10-02',
      login: 'alenam',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'administrator',
      position: 'Администратор',
      status: 'on_shift',
      photo_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
      comment: 'Координирует смену и бронирования.',
    },
    {
      id: 'u-hostess',
      name: 'Мария Лазарева',
      phone: '+7 900 100-10-03',
      login: 'hostess',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'hostess',
      position: 'Хостес',
      status: 'on_shift',
      photo_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80',
      comment: 'Встреча гостей, рассадка, звонки по броням.',
    },
    {
      id: 'u-waiter',
      name: 'Иван Соколов',
      phone: '+7 900 100-10-04',
      login: 'waiter',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'waiter',
      position: 'Официант',
      status: 'on_shift',
      photo_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
      comment: 'Зона 1 этаж, столы 1-6.',
    },
    {
      id: 'u-waiter-2',
      name: 'Нино Чантурия',
      phone: '+7 900 100-10-05',
      login: 'nino',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'waiter',
      position: 'Официант',
      status: 'off_shift',
      photo_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80',
      comment: 'Зона 2 этаж и банкеты.',
    },
    {
      id: 'u-kitchen',
      name: 'Давид Абашидзе',
      phone: '+7 900 100-10-06',
      login: 'kitchen',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'chef',
      position: 'Шеф-повар',
      status: 'on_shift',
      photo_url: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?auto=format&fit=crop&w=300&q=80',
      comment: 'Горячий цех, банкетное меню.',
    },
    {
      id: 'u-cook',
      name: 'Тамара Гелашвили',
      phone: '+7 900 100-10-07',
      login: 'tamara',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'cook',
      position: 'Повар',
      status: 'vacation',
      photo_url: 'https://images.unsplash.com/photo-1607746882042-944635dfe10e?auto=format&fit=crop&w=300&q=80',
      comment: 'Хинкали и хачапури.',
    },
    {
      id: 'u-bar',
      name: 'Сергей Бахтин',
      phone: '+7 900 100-10-08',
      login: 'bar',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'bar',
      position: 'Бармен',
      status: 'on_shift',
      photo_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
      comment: 'Барная карта, лимонады, винная полка.',
    },
    {
      id: 'u-security',
      name: 'Лев Омаров',
      phone: '+7 900 100-10-09',
      login: 'security',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'technical_staff',
      position: 'Охрана',
      status: 'on_shift',
      photo_url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80',
      comment: 'Входная зона, безопасность мероприятий.',
    },
    {
      id: 'u-technician',
      name: 'Техник Системы',
      phone: '+7 900 100-10-10',
      login: 'technician',
      password_hash: staffHash,
      password_plain: staffPassword,
      role: 'technician',
      position: 'Техник системы',
      status: 'off_shift',
      photo_url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80',
      comment: 'Полный системный доступ для обслуживания приложения.',
    },
  ];

  await upsertRows(client, 'users', users);

  const shifts = [
    ['s-1', 'u-admin', 0, '11:00', '23:00', 'Управляющий', 'Весь ресторан', 'active', 'Контроль банкета и вечерней посадки'],
    ['s-2', 'u-administrator', 0, '12:00', '00:00', 'Администратор', 'Зал', 'active', 'Смена с живой музыкой'],
    ['s-3', 'u-hostess', 0, '12:00', '23:00', 'Хостес', 'Вход / план зала', 'active', 'Прозвонить вечерние брони'],
    ['s-4', 'u-waiter', 0, '12:00', '23:30', 'Официант', '1 этаж', 'active', 'Столы 1-6'],
    ['s-5', 'u-kitchen', 0, '10:00', '23:30', 'Шеф-повар', 'Кухня', 'active', 'Проверить банкетные заготовки'],
    ['s-6', 'u-bar', 0, '12:00', '00:30', 'Бармен', 'Бар', 'active', 'Подготовить лимонады'],
    ['s-7', 'u-security', 0, '18:00', '02:00', 'Охрана', 'Вход', 'planned', 'Ожидается банкет'],
    ['s-8', 'u-waiter-2', 1, '14:00', '23:30', 'Официант', '2 этаж', 'planned', 'Подготовка свадьбы'],
    ['s-9', 'u-cook', 2, '10:00', '22:00', 'Повар', 'Хинкали', 'cancelled', 'Отпуск'],
  ].map(([id, user_id, offset, start_time, end_time, position, zone, status, comment]) => ({
    id,
    user_id,
    date: isoDate(offset),
    start_time,
    end_time,
    position,
    zone,
    status,
    comment,
  }));

  await upsertRows(client, 'shifts', shifts);

  const categories = [
    'Хинкали',
    'Хачапури',
    'Шашлык',
    'Мясо',
    'Рыба',
    'Горячие блюда',
    'Салаты',
    'Закуски',
    'Супы',
    'Гарниры',
    'Соусы',
    'Десерты',
    'Напитки',
    'Вино',
    'Коктейли',
    'Чай',
    'Кофе',
    'Детское меню',
    'Банкетное меню',
  ].map((name, index) => ({ id: `cat-${index + 1}`, name, sort_order: index + 1 }));

  await upsertRows(client, 'menu_categories', categories);

  const menuItems = [
    {
      id: 'dish-hinkali-classic',
      name: 'Хинкали классические',
      category_id: 'cat-1',
      price: 95,
      photo_url: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80',
      composition: 'Говядина, свинина, кинза, специи, тесто',
      weight: '1 шт / 90 г',
      cooking_time: '18 мин',
      allergens: 'глютен',
      calories: '210 ккал',
      description: 'Сочные хинкали ручной лепки с пряным бульоном.',
      waiter_hint: 'Рекомендуй гостям, которые хотят попробовать классику Кавказа. Напомни есть руками и сначала выпить бульон.',
      recommendation: 'Домашний тархун, саперави, сацебели.',
      spice_level: 2,
      popularity: 98,
      status: 'available',
      updated_by: 'u-admin',
    },
    {
      id: 'dish-hachapuri-adjar',
      name: 'Хачапури по-аджарски',
      category_id: 'cat-2',
      price: 590,
      photo_url: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=700&q=80',
      composition: 'Тесто, сулугуни, имеретинский сыр, яйцо, сливочное масло',
      weight: '430 г',
      cooking_time: '22 мин',
      allergens: 'глютен, молоко, яйцо',
      calories: '720 ккал',
      description: 'Лодочка с горячим сыром, яйцом и сливочным маслом.',
      waiter_hint: 'Предложи разделить на двоих к супу или салату. Важно подать сразу горячим.',
      recommendation: 'Салат с томатами, грузинский чай.',
      spice_level: 0,
      popularity: 95,
      status: 'soon_out',
      updated_by: 'u-kitchen',
    },
    {
      id: 'dish-shashlik-lamb',
      name: 'Шашлык из баранины',
      category_id: 'cat-3',
      price: 890,
      photo_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=700&q=80',
      composition: 'Баранина, лук, специи, лаваш',
      weight: '260 г',
      cooking_time: '28 мин',
      allergens: '',
      calories: '640 ккал',
      description: 'Сочный шашлык с дымным ароматом мангала.',
      waiter_hint: 'Хорошо продавать гостям, которые выбирают насыщенное мясное блюдо.',
      recommendation: 'Красное сухое вино, аджика, овощи на мангале.',
      spice_level: 1,
      popularity: 91,
      status: 'available',
      updated_by: 'u-admin',
    },
    {
      id: 'dish-dolma',
      name: 'Долма с мацони',
      category_id: 'cat-6',
      price: 560,
      photo_url: 'https://images.unsplash.com/photo-1625944525533-473f1a3d54e7?auto=format&fit=crop&w=700&q=80',
      composition: 'Виноградные листья, фарш, рис, зелень, мацони',
      weight: '240 г',
      cooking_time: '20 мин',
      allergens: 'молоко',
      calories: '390 ккал',
      description: 'Нежная долма в виноградных листьях с соусом мацони.',
      waiter_hint: 'Предложи как легкое горячее или на компанию к закускам.',
      recommendation: 'Белое вино, салат с зеленью.',
      spice_level: 1,
      popularity: 78,
      status: 'available',
      updated_by: 'u-kitchen',
    },
    {
      id: 'dish-salad-tomato',
      name: 'Салат с бакинскими томатами',
      category_id: 'cat-7',
      price: 520,
      photo_url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=700&q=80',
      composition: 'Томаты, красный лук, базилик, ореховая заправка',
      weight: '230 г',
      cooking_time: '10 мин',
      allergens: 'орехи',
      calories: '260 ккал',
      description: 'Свежий салат с яркой ореховой заправкой.',
      waiter_hint: 'Отличная рекомендация к хачапури и шашлыку.',
      recommendation: 'Минеральная вода, белое сухое.',
      spice_level: 0,
      popularity: 83,
      status: 'available',
      updated_by: 'u-admin',
    },
    {
      id: 'dish-kharcho',
      name: 'Суп харчо',
      category_id: 'cat-9',
      price: 480,
      photo_url: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=700&q=80',
      composition: 'Говядина, рис, томаты, ткемали, зелень, специи',
      weight: '350 г',
      cooking_time: '15 мин',
      allergens: '',
      calories: '430 ккал',
      description: 'Плотный пряный суп с говядиной и зеленью.',
      waiter_hint: 'Уточни желаемую остроту, предложи лаваш.',
      recommendation: 'Лаваш, зелень, красное вино.',
      spice_level: 3,
      popularity: 88,
      status: 'available',
      updated_by: 'u-kitchen',
    },
    {
      id: 'dish-trout',
      name: 'Форель на углях',
      category_id: 'cat-5',
      price: 980,
      photo_url: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=700&q=80',
      composition: 'Форель, лимон, зелень, специи',
      weight: '1 шт',
      cooking_time: '30 мин',
      allergens: 'рыба',
      calories: '520 ккал',
      description: 'Нежная рыба с легким ароматом углей.',
      waiter_hint: 'Подходит гостям, которые хотят более легкое горячее.',
      recommendation: 'Белое вино, овощи гриль.',
      spice_level: 0,
      popularity: 74,
      status: 'available',
      updated_by: 'u-admin',
    },
    {
      id: 'dish-ajapsandal',
      name: 'Аджапсандал',
      category_id: 'cat-8',
      price: 430,
      photo_url: 'https://images.unsplash.com/photo-1528712306091-ed0763094c98?auto=format&fit=crop&w=700&q=80',
      composition: 'Баклажаны, перец, томаты, зелень, чеснок',
      weight: '220 г',
      cooking_time: '8 мин',
      allergens: '',
      calories: '180 ккал',
      description: 'Овощная холодная закуска с зеленью.',
      waiter_hint: 'Хорошо поставить на стол первой волной закусок.',
      recommendation: 'Хачапури, лимонад груша-тархун.',
      spice_level: 1,
      popularity: 70,
      status: 'available',
      updated_by: 'u-kitchen',
    },
    {
      id: 'dish-potato',
      name: 'Картофель на мангале',
      category_id: 'cat-10',
      price: 310,
      photo_url: 'https://images.unsplash.com/photo-1518013431117-eb1465fa5752?auto=format&fit=crop&w=700&q=80',
      composition: 'Картофель, чесночное масло, зелень',
      weight: '180 г',
      cooking_time: '18 мин',
      allergens: 'молоко',
      calories: '310 ккал',
      description: 'Румяный картофель с чесночным маслом.',
      waiter_hint: 'Базовый гарнир к шашлыкам и рыбе.',
      recommendation: 'Шашлык, сацебели.',
      spice_level: 0,
      popularity: 76,
      status: 'available',
      updated_by: 'u-admin',
    },
    {
      id: 'dish-napoleon',
      name: 'Медовый наполеон',
      category_id: 'cat-12',
      price: 390,
      photo_url: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=700&q=80',
      composition: 'Слоеное тесто, медовый крем, ореховая крошка',
      weight: '150 г',
      cooking_time: '5 мин',
      allergens: 'глютен, молоко, орехи',
      calories: '470 ккал',
      description: 'Домашний десерт с мягким медовым кремом.',
      waiter_hint: 'Хорошо закрывает ужин после острого горячего.',
      recommendation: 'Чай с чабрецом, кофе.',
      spice_level: 0,
      popularity: 86,
      status: 'available',
      updated_by: 'u-admin',
    },
    {
      id: 'drink-tarhun',
      name: 'Домашний тархун',
      category_id: 'cat-13',
      price: 290,
      photo_url: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=700&q=80',
      composition: 'Эстрагон, лайм, сироп, газированная вода',
      weight: '350 мл',
      cooking_time: '4 мин',
      allergens: '',
      calories: '130 ккал',
      description: 'Свежий лимонад с ароматом эстрагона.',
      waiter_hint: 'Ставь в пару к хинкали и острым блюдам.',
      recommendation: 'Хинкали, харчо.',
      spice_level: 0,
      popularity: 90,
      status: 'available',
      updated_by: 'u-bar',
    },
    {
      id: 'wine-saperavi',
      name: 'Саперави бокал',
      category_id: 'cat-14',
      price: 430,
      photo_url: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=700&q=80',
      composition: 'Красное сухое вино, Грузия',
      weight: '150 мл',
      cooking_time: '2 мин',
      allergens: 'сульфиты',
      calories: '',
      description: 'Насыщенное красное вино к мясу и пряным блюдам.',
      waiter_hint: 'Предлагай к баранине, харчо и насыщенным закускам.',
      recommendation: 'Шашлык, долма, харчо.',
      spice_level: 0,
      popularity: 81,
      status: 'stop',
      updated_by: 'u-bar',
    },
    {
      id: 'cocktail-pomegranate',
      name: 'Гранатовый сауэр',
      category_id: 'cat-15',
      price: 620,
      photo_url: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?auto=format&fit=crop&w=700&q=80',
      composition: 'Гранат, цитрус, белок, биттер',
      weight: '180 мл',
      cooking_time: '6 мин',
      allergens: 'яйцо',
      calories: '',
      description: 'Кисло-сладкий коктейль с плотной пеной.',
      waiter_hint: 'Хорош для гостей, которые хотят авторский коктейль без сильной горечи.',
      recommendation: 'Закуски, сырная тарелка.',
      spice_level: 0,
      popularity: 77,
      status: 'available',
      updated_by: 'u-bar',
    },
    {
      id: 'banquet-set',
      name: 'Банкетный сет Кавказ',
      category_id: 'cat-19',
      price: 3200,
      photo_url: 'https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=700&q=80',
      composition: 'Ассорти закусок, салаты, хачапури, горячее, гарниры',
      weight: 'на 1 гостя',
      cooking_time: 'по таймингу банкета',
      allergens: 'уточнять по блюдам',
      calories: '',
      description: 'Базовый банкетный набор для мероприятий от 10 гостей.',
      waiter_hint: 'Уточнить повод, детей, аллергии и тайминг горячего.',
      recommendation: 'Винная полка, домашние лимонады.',
      spice_level: 1,
      popularity: 64,
      status: 'available',
      updated_by: 'u-admin',
    },
  ];

  await upsertRows(client, 'menu_items', menuItems);

  const stopList = [
    {
      id: 'stop-1',
      menu_item_id: 'wine-saperavi',
      reason: 'Закончилась открытая бутылка, новая партия завтра',
      status: 'out',
      added_by: 'u-bar',
      created_at: isoDateTime(0, '12:20'),
      expected_return_at: isoDateTime(1, '13:00'),
      comment: 'Предлагать мукузани бокал.',
    },
    {
      id: 'stop-2',
      menu_item_id: 'dish-hachapuri-adjar',
      reason: 'Осталось мало сулугуни',
      status: 'soon_out',
      added_by: 'u-kitchen',
      created_at: isoDateTime(0, '13:10'),
      expected_return_at: isoDateTime(0, '18:00'),
      comment: 'До 18:00 продавать осторожно, уточнять у кухни.',
    },
    {
      id: 'stop-3',
      menu_item_id: 'dish-trout',
      reason: 'Поставка задерживается',
      status: 'back_later',
      added_by: 'u-admin',
      created_at: isoDateTime(-1, '21:00'),
      expected_return_at: isoDateTime(0, '17:30'),
      comment: 'Можно предлагать сибаса дня.',
    },
  ];

  await upsertRows(client, 'stop_list', stopList);

  await upsertRows(client, 'floors', [
    { id: 'floor-1', name: '1 этаж', sort_order: 1 },
    { id: 'floor-2', name: '2 этаж', sort_order: 2 },
  ]);

  const tables = [
    ['t-1', 'floor-1', '1', 2, 8, 12, 13, 13, 'round', 'free', 'u-waiter', 'У окна'],
    ['t-2', 'floor-1', '2', 4, 28, 12, 16, 14, 'square', 'occupied', 'u-waiter', 'Гости с ребенком'],
    ['t-3', 'floor-1', '3', 4, 50, 12, 16, 14, 'square', 'reserved', 'u-waiter', 'Бронь на 19:30'],
    ['t-4', 'floor-1', '4', 6, 74, 14, 22, 14, 'rect', 'soon_reserved', 'u-waiter', 'Подготовить к 20:00'],
    ['t-5', 'floor-1', '5', 2, 15, 42, 13, 13, 'round', 'cleaning', 'u-waiter', 'После гостей'],
    ['t-6', 'floor-1', '6', 8, 44, 42, 28, 16, 'rect', 'banquet', 'u-waiter', 'Мини-банкет'],
    ['t-7', 'floor-1', '7', 4, 78, 46, 16, 14, 'square', 'free', 'u-waiter', 'Рядом сцена'],
    ['t-8', 'floor-2', '8', 2, 10, 16, 13, 13, 'round', 'free', 'u-waiter-2', 'Балкон'],
    ['t-9', 'floor-2', '9', 4, 31, 18, 16, 14, 'square', 'expected', 'u-waiter-2', 'Ожидаем гостей'],
    ['t-10', 'floor-2', '10', 6, 56, 20, 22, 15, 'rect', 'occupied', 'u-waiter-2', 'День рождения'],
    ['t-11', 'floor-2', '11', 10, 22, 52, 34, 18, 'rect', 'banquet', 'u-waiter-2', 'Банкетная зона'],
    ['t-12', 'floor-2', '12', 4, 73, 54, 16, 14, 'square', 'closed', null, 'Не использовать, ремонт светильника'],
  ].map(([id, floor_id, number, seats, x_position, y_position, width, height, shape, status, current_waiter_id, comment]) => ({
    id,
    floor_id,
    number,
    seats,
    x_position,
    y_position,
    width,
    height,
    shape,
    status,
    current_waiter_id,
    comment,
    checkin_token: `GORY${String(number).padStart(2, '0')}`,
  }));

  await upsertRows(client, 'tables', tables);

  const reservations = [
    {
      id: 'r-1',
      guest_name: 'Анна Петрова',
      guest_phone: '+7 921 555-44-11',
      date: isoDate(0),
      time: '19:30',
      guests_count: 4,
      table_id: 't-3',
      occasion: 'birthday',
      status: 'confirmed',
      source: 'phone',
      comment: 'День рождения, нужен десерт со свечой.',
      created_by: 'u-hostess',
      created_at: isoDateTime(0, '11:40'),
    },
    {
      id: 'r-2',
      guest_name: 'Михаил Орлов',
      guest_phone: '+7 926 222-18-90',
      date: isoDate(0),
      time: '20:00',
      guests_count: 6,
      table_id: 't-4',
      occasion: 'family_dinner',
      status: 'waiting',
      source: 'phone',
      comment: 'Гость просил стол не у музыки.',
      created_by: 'u-administrator',
      created_at: isoDateTime(0, '12:10'),
    },
    {
      id: 'r-3',
      guest_name: 'София Гвелесиани',
      guest_phone: '+7 903 777-20-20',
      date: isoDate(0),
      time: '18:15',
      guests_count: 2,
      table_id: 't-9',
      occasion: 'date',
      status: 'waiting',
      source: 'messenger',
      comment: 'Поставить цветы, гости придут на 10 минут позже.',
      created_by: 'u-hostess',
      created_at: isoDateTime(0, '10:05'),
    },
    {
      id: 'r-4',
      guest_name: 'Компания Альфа',
      guest_phone: '+7 495 111-22-33',
      date: isoDate(1),
      time: '19:00',
      guests_count: 12,
      table_id: 't-11',
      occasion: 'corporate',
      status: 'confirmed',
      source: 'admin',
      comment: 'Предзаказ закусок и безалкогольных напитков.',
      created_by: 'u-admin',
      created_at: isoDateTime(-1, '17:00'),
    },
  ];

  await upsertRows(client, 'reservations', reservations);

  const events = [
    {
      id: 'e-1',
      title: 'Юбилей семьи Гогитидзе',
      type: 'jubilee',
      date: isoDate(0),
      time: '20:30',
      guests_count: 22,
      customer_name: 'Лали Гогитидзе',
      customer_phone: '+7 910 444-33-22',
      floor_id: 'floor-2',
      table_ids: ['t-10', 't-11'],
      banquet_menu: ['banquet-set', 'dish-hinkali-classic', 'drink-tarhun'],
      comment: 'Живая музыка после 21:00, торт привезут гости.',
      kitchen_comment: 'Горячее отдавать в 21:20, хачапури первой волной.',
      waiter_comment: 'Проверить детский стул и дополнительные приборы.',
      responsible_user_id: 'u-administrator',
      status: 'preparation',
    },
    {
      id: 'e-2',
      title: 'Свадебный ужин',
      type: 'wedding',
      date: isoDate(2),
      time: '18:00',
      guests_count: 45,
      customer_name: 'Карина и Артем',
      customer_phone: '+7 911 777-66-55',
      floor_id: 'floor-2',
      table_ids: ['t-10', 't-11', 't-12'],
      banquet_menu: ['banquet-set', 'dish-trout', 'wine-saperavi'],
      comment: 'Закрытое мероприятие на 2 этаже.',
      kitchen_comment: 'Без кинзы для 6 гостей, 2 детских блюда.',
      waiter_comment: 'План рассадки загрузят позже.',
      responsible_user_id: 'u-admin',
      status: 'confirmed',
    },
  ];

  await upsertRows(client, 'events', events);

  const announcements = [
    {
      id: 'a-1',
      title: 'Сегодня живая музыка с 20:00',
      text: 'Просим заранее предупреждать гостей о возможной громкости у сцены. Столы 6 и 7 предлагать тем, кто хочет быть ближе к музыке.',
      author_id: 'u-admin',
      target_role: 'all',
      importance: 'important',
      created_at: isoDateTime(0, '09:30'),
    },
    {
      id: 'a-2',
      title: 'Кухня: уточнять хачапури',
      text: 'Сулугуни осталось немного, до вечерней поставки подтверждаем каждую продажу хачапури по-аджарски.',
      author_id: 'u-kitchen',
      target_role: 'waiter',
      importance: 'urgent',
      created_at: isoDateTime(0, '13:15'),
    },
    {
      id: 'a-3',
      title: 'Хостес: прозвонить брони после 18:00',
      text: 'По всем броням от 6 гостей уточнить время прихода и повод визита.',
      author_id: 'u-administrator',
      target_role: 'hostess',
      importance: 'normal',
      created_at: isoDateTime(0, '12:45'),
    },
  ];

  await upsertRows(client, 'announcements', announcements);

  const rules = [
    {
      id: 'rule-1',
      title: 'Как встречать гостей',
      category: 'Сервис',
      content: 'Встречаем в течение 10 секунд, улыбаемся, уточняем бронь и количество гостей. Если есть ожидание, называем честное время и предлагаем напитки у бара.',
      created_at: isoDateTime(-5, '12:00'),
    },
    {
      id: 'rule-2',
      title: 'Если блюдо в стоп-листе',
      category: 'Меню',
      content: 'Не обещаем блюдо гостю до подтверждения кухни или бара. Предлагаем ближайшую альтернативу и сразу обновляем информацию в чате смены.',
      created_at: isoDateTime(-5, '12:10'),
    },
    {
      id: 'rule-3',
      title: 'Работа с конфликтом',
      category: 'Гости',
      content: 'Слушаем без спора, фиксируем проблему, зовем администратора. Не обсуждаем гостя при других гостях и не перекладываем ответственность на кухню или зал.',
      created_at: isoDateTime(-4, '15:30'),
    },
    {
      id: 'rule-4',
      title: 'Закрытие смены',
      category: 'Смена',
      content: 'Проверить чистоту зоны, передать незакрытые задачи, обновить стоп-лист, отметить проблемные столы и оставить сообщение в чате смены.',
      created_at: isoDateTime(-3, '18:00'),
    },
  ];

  await upsertRows(client, 'rules', rules);

  const tasks = [
    {
      id: 'task-1',
      title: 'Проверить входную зону',
      description: 'Чистота, меню у стойки, свободный проход для гостей.',
      assigned_to: 'u-hostess',
      due_date: isoDateTime(0, '16:00'),
      status: 'in_progress',
      comment: 'Проверить перед вечерней посадкой.',
      created_by: 'u-administrator',
      photo_required: false,
    },
    {
      id: 'task-2',
      title: 'Обновить стоп-лист перед ужином',
      description: 'Сверить кухню, бар и официантов, закрепить сообщение в чате смены.',
      assigned_to: 'u-kitchen',
      due_date: isoDateTime(0, '17:00'),
      status: 'new',
      comment: 'Особенно хачапури и вино.',
      created_by: 'u-admin',
      photo_required: false,
    },
    {
      id: 'task-3',
      title: 'Подготовить банкетную зону',
      description: 'Столы 10-11, приборы, вода, детский стул, место под торт.',
      assigned_to: 'u-waiter-2',
      due_date: isoDateTime(0, '19:30'),
      status: 'new',
      comment: 'Проверить с администратором.',
      created_by: 'u-administrator',
      photo_required: true,
    },
    {
      id: 'task-4',
      title: 'Проверить барную заготовку',
      description: 'Лимонады, лед, мята, гранатовый сироп, бокалы.',
      assigned_to: 'u-bar',
      due_date: isoDateTime(0, '17:30'),
      status: 'done',
      comment: 'Лед заказан дополнительно.',
      created_by: 'u-admin',
      photo_required: false,
    },
  ];

  await upsertRows(client, 'tasks', tasks);

  const chats = [
    { id: 'chat-general', name: 'Общий чат ресторана', type: 'general', created_by: 'u-admin', created_at: isoDateTime(-10, '10:00') },
    { id: 'chat-hall', name: 'Зал', type: 'department', created_by: 'u-administrator', created_at: isoDateTime(-9, '10:00') },
    { id: 'chat-kitchen', name: 'Кухня', type: 'department', created_by: 'u-kitchen', created_at: isoDateTime(-9, '10:00') },
    { id: 'chat-bar', name: 'Бар', type: 'department', created_by: 'u-bar', created_at: isoDateTime(-9, '10:00') },
    { id: 'chat-hostess', name: 'Хостес', type: 'department', created_by: 'u-administrator', created_at: isoDateTime(-9, '10:00') },
    { id: 'chat-admins', name: 'Администраторы', type: 'department', created_by: 'u-admin', created_at: isoDateTime(-9, '10:00') },
    { id: 'chat-management', name: 'Управление', type: 'department', created_by: 'u-admin', created_at: isoDateTime(-9, '10:00') },
    { id: 'chat-events', name: 'Банкеты', type: 'department', created_by: 'u-admin', created_at: isoDateTime(-8, '10:00') },
    { id: 'chat-shift', name: 'Смена сегодня', type: 'shift', created_by: 'u-administrator', created_at: isoDateTime(0, '09:00') },
    { id: 'chat-dm-admin-hostess', name: 'Георгий / Мария', type: 'direct', created_by: 'u-admin', created_at: isoDateTime(-2, '11:00') },
  ];

  await upsertRows(client, 'chats', chats);

  const allUserIds = users.map((user) => user.id);
  const members = [];
  let memberIndex = 1;
  function addMembers(chatId, userIds, roleInChat = 'member') {
    userIds.forEach((userId) => {
      members.push({
        id: `cm-${memberIndex++}`,
        chat_id: chatId,
        user_id: userId,
        role_in_chat: userId === 'u-admin' ? 'owner' : roleInChat,
        joined_at: isoDateTime(-8, '12:00'),
      });
    });
  }

  addMembers('chat-general', allUserIds);
  addMembers('chat-hall', ['u-admin', 'u-administrator', 'u-hostess', 'u-waiter', 'u-waiter-2', 'u-technician']);
  addMembers('chat-kitchen', ['u-admin', 'u-administrator', 'u-kitchen', 'u-cook', 'u-technician']);
  addMembers('chat-bar', ['u-admin', 'u-administrator', 'u-bar', 'u-technician']);
  addMembers('chat-hostess', ['u-admin', 'u-administrator', 'u-hostess', 'u-technician']);
  addMembers('chat-admins', ['u-owner', 'u-admin', 'u-administrator', 'u-technician']);
  addMembers('chat-management', ['u-owner', 'u-admin', 'u-administrator', 'u-technician']);
  addMembers('chat-events', ['u-admin', 'u-administrator', 'u-hostess', 'u-waiter', 'u-waiter-2', 'u-kitchen', 'u-bar', 'u-technician']);
  addMembers('chat-shift', ['u-admin', 'u-administrator', 'u-hostess', 'u-waiter', 'u-kitchen', 'u-bar', 'u-security', 'u-technician']);
  addMembers('chat-dm-admin-hostess', ['u-admin', 'u-hostess']);

  await upsertRows(client, 'chat_members', members);

  const messages = [
    {
      id: 'msg-1',
      chat_id: 'chat-general',
      sender_id: 'u-admin',
      message_text: 'Коллеги, сегодня полный зал после 19:00. Проверяем стоп-лист и брони каждые 30 минут.',
      message_type: 'text',
      file_url: null,
      is_pinned: true,
      created_at: isoDateTime(0, '12:05'),
      edited_at: null,
      deleted_at: null,
    },
    {
      id: 'msg-2',
      chat_id: 'chat-shift',
      sender_id: 'u-administrator',
      message_text: '@Хостес, бронь Петровой на 19:30 подтвердили. Нужна свеча на десерт.',
      message_type: 'text',
      file_url: null,
      is_pinned: true,
      created_at: isoDateTime(0, '12:42'),
      edited_at: null,
      deleted_at: null,
    },
    {
      id: 'msg-3',
      chat_id: 'chat-kitchen',
      sender_id: 'u-kitchen',
      message_text: '@Зал, хачапури по-аджарски подтверждать перед заказом до поставки сыра.',
      message_type: 'text',
      file_url: null,
      is_pinned: true,
      created_at: isoDateTime(0, '13:12'),
      edited_at: null,
      deleted_at: null,
    },
    {
      id: 'msg-4',
      chat_id: 'chat-bar',
      sender_id: 'u-bar',
      message_text: 'Саперави бокал в стопе, предлагаю мукузани. Лимонады готовы.',
      message_type: 'text',
      file_url: null,
      is_pinned: false,
      created_at: isoDateTime(0, '13:25'),
      edited_at: null,
      deleted_at: null,
    },
    {
      id: 'msg-5',
      chat_id: 'chat-events',
      sender_id: 'u-administrator',
      message_text: 'По юбилею Гогитидзе: горячее в 21:20, торт привезут гости. Проверить детский стул.',
      message_type: 'text',
      file_url: null,
      is_pinned: true,
      created_at: isoDateTime(0, '14:00'),
      edited_at: null,
      deleted_at: null,
    },
    {
      id: 'msg-6',
      chat_id: 'chat-dm-admin-hostess',
      sender_id: 'u-hostess',
      message_text: 'Георгий, стол 12 закрыт из-за светильника, бронь туда не ставлю.',
      message_type: 'text',
      file_url: null,
      is_pinned: false,
      created_at: isoDateTime(0, '14:15'),
      edited_at: null,
      deleted_at: null,
    },
  ];

  await upsertRows(client, 'chat_messages', messages);

  await upsertRows(
    client,
    'message_reads',
    messages.slice(0, 4).map((message, index) => ({
      id: `read-${index + 1}`,
      message_id: message.id,
      user_id: index % 2 === 0 ? 'u-admin' : 'u-hostess',
      read_at: isoDateTime(0, '14:30'),
    })),
  );

  const notifications = [
    {
      id: 'n-1',
      user_id: null,
      target_role: 'all',
      title: 'Новое важное объявление',
      text: 'Сегодня живая музыка с 20:00.',
      type: 'announcement',
      is_read: false,
      created_at: isoDateTime(0, '09:31'),
    },
    {
      id: 'n-2',
      user_id: null,
      target_role: 'waiter',
      title: 'Блюдо в стоп-листе',
      text: 'Саперави бокал временно недоступен.',
      type: 'stop_list',
      is_read: false,
      created_at: isoDateTime(0, '12:21'),
    },
    {
      id: 'n-3',
      user_id: 'u-hostess',
      target_role: 'hostess',
      title: 'Бронь скоро',
      text: 'Стол 3, Анна Петрова, 19:30.',
      type: 'reservation',
      is_read: false,
      created_at: isoDateTime(0, '17:45'),
    },
  ];

  await upsertRows(client, 'notifications', notifications);

  await upsertRows(client, 'activity_log', [
    {
      id: 'log-1',
      user_id: 'u-bar',
      action: 'stop_list.added',
      entity_type: 'stop_list',
      entity_id: 'stop-1',
      old_value: null,
      new_value: { status: 'out', menu_item_id: 'wine-saperavi' },
      created_at: isoDateTime(0, '12:20'),
    },
    {
      id: 'log-2',
      user_id: 'u-hostess',
      action: 'reservation.created',
      entity_type: 'reservation',
      entity_id: 'r-1',
      old_value: null,
      new_value: { guest_name: 'Анна Петрова', table_id: 't-3' },
      created_at: isoDateTime(0, '11:40'),
    },
    {
      id: 'log-3',
      user_id: 'u-administrator',
      action: 'table.status_changed',
      entity_type: 'table',
      entity_id: 't-5',
      old_value: { status: 'occupied' },
      new_value: { status: 'cleaning' },
      created_at: isoDateTime(0, '14:10'),
    },
  ]);

  await upsertRows(client, 'guest_segments', [
    {
      id: 'seg-inactive-60',
      name: 'VIP без визита 60 дней',
      description: 'Гости с бонусами, которые давно не были в ресторане.',
      rules_json: { inactive_days: 60, min_bonus: 300 },
    },
    {
      id: 'seg-gold-plus',
      name: 'Золото и платина',
      description: 'Постоянные гости высоких уровней лояльности.',
      rules_json: { loyalty_level: 'gold' },
    },
    {
      id: 'seg-new-guests',
      name: 'Новые гости',
      description: 'Зарегистрировались в приложении, визитов ещё не было.',
      rules_json: { max_visits: 0 },
    },
  ]);
}

module.exports = {
  backfillConfiguredPasswords,
  loadRestaurantSourceData,
  seedDatabase,
  seedRestaurantSourceData,
  seedRoles,
};
