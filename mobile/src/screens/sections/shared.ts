import type { DataSnapshot, MenuItem, RoleName, User } from '../../types';

export const reservationLabels: Record<string, string> = {
  new: 'Новая',
  confirmed: 'Подтверждена',
  waiting: 'Ожидаем гостей',
  guests_arrived: 'Гости пришли',
  seated: 'Гости сидят',
  guests_left: 'Гости ушли',
  cancelled: 'Отменена',
  no_show: 'Не пришли',
};

export const stopLabels: Record<string, string> = {
  out: 'Нет в наличии',
  soon_out: 'Скоро закончится',
  temporary: 'Временно не готовим',
  back_later: 'Вернется позже',
  available: 'Снова доступно',
};

export const shiftLabels: Record<string, string> = {
  planned: 'Запланирована',
  active: 'Идет',
  done: 'Завершена',
  cancelled: 'Отменена',
};

export const taskLabels: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
};

export const assignableRoles: { role: RoleName; label: string; position: string }[] = [
  { role: 'waiter', label: 'Официант', position: 'Официант' },
  { role: 'hostess', label: 'Хостес', position: 'Хостес' },
  { role: 'chef', label: 'Шеф-повар', position: 'Шеф-повар' },
  { role: 'cook', label: 'Повар', position: 'Повар' },
  { role: 'bar', label: 'Бар', position: 'Бармен' },
  { role: 'administrator', label: 'Админ смены', position: 'Администратор' },
  { role: 'manager', label: 'Управляющий', position: 'Управляющий' },
  { role: 'owner', label: 'Владелец', position: 'Владелец' },
  { role: 'technical_staff', label: 'Техперсонал', position: 'Техперсонал' },
  { role: 'technician', label: 'Техник системы', position: 'Техник системы' },
];

const barCategoryIds = new Set(['cat-13', 'cat-14', 'cat-15', 'cat-16', 'cat-17']);

assignableRoles.splice(assignableRoles.length - 1, 0, {
  role: 'smm_manager',
  label: 'SMM',
  position: 'SMM РјРµРЅРµРґР¶РµСЂ',
});

export const userStatusLabels: Partial<Record<User['status'], string>> = {
  on_shift: 'На смене',
  off_shift: 'Не на смене',
  sick: 'Больничный',
  vacation: 'Отпуск',
  active: 'Активен',
  inactive: 'Неактивен',
  blocked: 'Заблокирован',
  fired: 'Уволен',
};

export const staffStatusActions: { status: User['status']; label: string }[] = [
  { status: 'on_shift', label: 'На смене' },
  { status: 'off_shift', label: 'Не на смене' },
  { status: 'sick', label: 'Больничный' },
  { status: 'vacation', label: 'Отпуск' },
];

export function isBarCategory(categoryId?: string | null) {
  return Boolean(categoryId && barCategoryIds.has(categoryId));
}

export function isBarMenuItem(snapshot: DataSnapshot, item?: MenuItem | null) {
  if (!item) return false;
  const type = String(item.item_type ?? '').toLowerCase();
  const category = categoryName(snapshot, item.category_id).toLowerCase();
  const text = `${item.name} ${item.description ?? ''} ${item.composition ?? ''} ${category}`.toLowerCase();
  return Boolean(
    isBarCategory(item.category_id) ||
      item.is_bar ||
      ['bar', 'drink', 'alcohol'].includes(type) ||
      /бар|напит|вино|алког|коктей|пиво|лимонад|чай|кофе|сок|виски|водка|коньяк/.test(text),
  );
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function shortDate(value?: string | null) {
  if (!value) return 'Не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

export function shortDateTime(value?: string | null) {
  if (!value) return 'Не указано';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function userName(snapshot: DataSnapshot, id?: string | null) {
  return snapshot.users.find((user) => user.id === id)?.name ?? 'Не назначен';
}

export function menuItem(snapshot: DataSnapshot, id: string) {
  return snapshot.menu_items.find((item) => item.id === id);
}

export function categoryName(snapshot: DataSnapshot, id?: string | null) {
  return snapshot.menu_categories.find((category) => category.id === id)?.name ?? 'Без категории';
}

export function tableName(snapshot: DataSnapshot, id?: string | null) {
  if (!id) return 'Стол не выбран';
  const table = snapshot.tables.find((item) => item.id === id);
  return table ? `Стол ${table.number}, ${table.seats} мест` : 'Стол не найден';
}

export function roleTone(status?: string) {
  if (status === 'on_shift' || status === 'active' || status === 'done' || status === 'free') return 'good' as const;
  if (status === 'cancelled' || status === 'out' || status === 'occupied') return 'bad' as const;
  if (status === 'soon_out' || status === 'waiting' || status === 'reserved' || status === 'bill_waiting') return 'warn' as const;
  return 'neutral' as const;
}
