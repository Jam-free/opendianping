import { v4 as uuidv4 } from 'uuid';
import type { MiniDatabase } from './types.js';

/**
 * 本机 2026-11-07 快照有两种形状：
 * 1. COS/备份 JSON：{ schemaVersion, tables: { shops, users, ... } }
 * 2. 小程序导出：{ mine: [{ poiKey, name, ... }], friendsShared: [] }
 * CSV 库存表头：poiKey,name,category,city,district,address,origin,status,wishlist
 *
 * 真正写生产要等 Jam 确认；脚本默认 dry-run。
 */

export type SnapshotShop = {
  poiKey: string;
  name: string;
  category: string | null;
  district: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  origin: string | null;
  wishlist: boolean;
  phone: string | null;
  status: string | null;
};

export type ParsedSnapshot = {
  kind: 'backup' | 'fm_shops' | 'csv';
  shops: SnapshotShop[];
  backupTables?: Record<string, Record<string, unknown>[]>;
};

export type ImportPlan = {
  shopInserts: number;
  shopUpdates: number;
  favoriteInserts: number;
  skipped: number;
  skippedReasons: string[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolish(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v || '').toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function originToSourceType(origin: string | null): string {
  if (origin === 'imported') return 'dianping_album';
  if (origin === 'checkin' || origin === 'agent') return 'photo';
  return 'text';
}

export function parseFmShopRow(row: Record<string, unknown>): SnapshotShop | null {
  const poiKey = str(row.poiKey || row.poi_key || row.source_shop_id);
  const name = str(row.name || row.raw_name);
  if (!poiKey || !name) return null;
  return {
    poiKey,
    name,
    category: str(row.category),
    district: str(row.district),
    city: str(row.city),
    address: str(row.address),
    lat: num(row.lat),
    lng: num(row.lng),
    note: str(row.note),
    origin: str(row.origin),
    wishlist: boolish(row.wishlist),
    phone: str(row.phone),
    status: str(row.status) || 'confirmed',
  };
}

export function parseCsvInventory(text: string): SnapshotShop[] {
  const lines = text.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    if (!t) return false;
    // 库存 CSV 表头是 `#,poiKey,...`；只有「整行注释」才跳过
    if (t.startsWith('#') && !t.includes(',')) return false;
    return true;
  });
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!);
  const idx = (name: string) =>
    header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const shops: SnapshotShop[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const get = (name: string) => {
      const i = idx(name);
      return i >= 0 ? cols[i] : '';
    };
    const shop = parseFmShopRow({
      poiKey: get('poiKey'),
      name: get('name'),
      category: get('category'),
      city: get('city'),
      district: get('district'),
      address: get('address'),
      origin: get('origin'),
      status: get('status'),
      wishlist: get('wishlist'),
      lat: get('lat'),
      lng: get('lng'),
      phone: get('phone'),
    });
    if (shop) shops.push(shop);
  }
  return shops;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseSnapshotPayload(raw: unknown, csvText?: string): ParsedSnapshot {
  if (typeof csvText === 'string' && csvText.trim()) {
    return { kind: 'csv', shops: parseCsvInventory(csvText) };
  }
  const obj = asRecord(raw);
  if (!obj) throw new Error('快照不是 JSON 对象');

  if (obj.tables && typeof obj.tables === 'object') {
    const tables = obj.tables as Record<string, Record<string, unknown>[]>;
    const shopRows = Array.isArray(tables.shops) ? tables.shops : [];
    const shops: SnapshotShop[] = [];
    for (const row of shopRows) {
      const parsed = parseFmShopRow({
        poiKey: row.source_shop_id || row.amap_poi_id || row.id,
        name: row.raw_name || row.name,
        category: row.category,
        district: row.district,
        city: row.city,
        address: row.address,
        lat: row.lat,
        lng: row.lng,
        phone: row.phone,
        origin: row.source_type === 'dianping_album' ? 'imported' : 'checkin',
        status: 'confirmed',
        wishlist: false,
      });
      if (parsed) shops.push(parsed);
    }
    return { kind: 'backup', shops, backupTables: tables };
  }

  const mine = Array.isArray(obj.mine) ? obj.mine : [];
  const friends = Array.isArray(obj.friendsShared) ? obj.friendsShared : [];
  const shops: SnapshotShop[] = [];
  for (const row of [...mine, ...friends]) {
    const rec = asRecord(row);
    if (!rec) continue;
    const parsed = parseFmShopRow(rec);
    if (parsed) shops.push(parsed);
  }
  return { kind: 'fm_shops', shops };
}

export function planShopImport(
  database: MiniDatabase,
  shops: SnapshotShop[],
  options: { includePending?: boolean; userId?: string } = {}
): ImportPlan {
  const skippedReasons: string[] = [];
  let shopInserts = 0;
  let shopUpdates = 0;
  let favoriteInserts = 0;
  let skipped = 0;

  const findByPoi = database.prepare(
    `SELECT id FROM shops WHERE source_shop_id = ? OR amap_poi_id = ? OR id = ?`
  );

  for (const shop of shops) {
    if (!options.includePending && shop.status && shop.status !== 'confirmed') {
      skipped += 1;
      skippedReasons.push(`${shop.poiKey}: status=${shop.status}`);
      continue;
    }
    const existing = findByPoi.get(shop.poiKey, shop.poiKey, shop.poiKey) as
      | { id: string }
      | undefined;
    if (existing) shopUpdates += 1;
    else shopInserts += 1;

    if (options.userId) {
      const shopId = existing?.id || `pending`;
      if (existing) {
        const fav = database
          .prepare(`SELECT id FROM favorites WHERE user_id = ? AND shop_id = ?`)
          .get(options.userId, shopId) as { id: string } | undefined;
        if (!fav) favoriteInserts += 1;
      } else {
        favoriteInserts += 1;
      }
    }
  }

  return { shopInserts, shopUpdates, favoriteInserts, skipped, skippedReasons };
}

export function applyShopImport(
  database: MiniDatabase,
  shops: SnapshotShop[],
  options: { includePending?: boolean; userId?: string } = {}
): ImportPlan {
  const plan: ImportPlan = {
    shopInserts: 0,
    shopUpdates: 0,
    favoriteInserts: 0,
    skipped: 0,
    skippedReasons: [],
  };

  const tx = database.transaction(() => {
    for (const shop of shops) {
      if (!options.includePending && shop.status && shop.status !== 'confirmed') {
        plan.skipped += 1;
        plan.skippedReasons.push(`${shop.poiKey}: status=${shop.status}`);
        continue;
      }
      const existing = database
        .prepare(
          `SELECT id FROM shops WHERE source_shop_id = ? OR amap_poi_id = ? OR id = ?`
        )
        .get(shop.poiKey, shop.poiKey, shop.poiKey) as { id: string } | undefined;

      const shopId = existing?.id || uuidv4();
      if (existing) {
        database
          .prepare(
            `UPDATE shops SET raw_name = ?, category = ?, district = ?, city = ?,
              address = ?, lat = ?, lng = ?, phone = ?, source_shop_id = COALESCE(source_shop_id, ?)
             WHERE id = ?`
          )
          .run(
            shop.name,
            shop.category,
            shop.district,
            shop.city,
            shop.address,
            shop.lat,
            shop.lng,
            shop.phone,
            shop.poiKey,
            shopId
          );
        plan.shopUpdates += 1;
      } else {
        database
          .prepare(
            `INSERT INTO shops (
               id, source_type, source_shop_id, amap_poi_id, raw_name, adcode, category,
               district, city, address, avg_price, lat, lng, source_url, head_img,
               display_cache_policy, phone
             ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, 'minimal', ?)`
          )
          .run(
            shopId,
            originToSourceType(shop.origin),
            shop.poiKey,
            shop.name,
            shop.category,
            shop.district,
            shop.city,
            shop.address,
            shop.lat,
            shop.lng,
            shop.phone
          );
        plan.shopInserts += 1;
      }

      if (options.userId) {
        const fav = database
          .prepare(`SELECT id FROM favorites WHERE user_id = ? AND shop_id = ?`)
          .get(options.userId, shopId) as { id: string } | undefined;
        if (!fav) {
          database
            .prepare(
              `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at, wishlist)
               VALUES (?, ?, ?, ?, 'private', ?, ?)`
            )
            .run(
              uuidv4(),
              options.userId,
              shopId,
              shop.note,
              new Date().toISOString(),
              shop.wishlist ? 1 : 0
            );
          plan.favoriteInserts += 1;
        }
      }
    }
  });
  tx();
  return plan;
}

export function maskPhone(phone: unknown): unknown {
  const s = str(phone);
  if (!s) return phone;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7) return s;
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

export function redactBackupPayload(payload: {
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}): typeof payload {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(payload.tables || {})) {
    if (name === 'sessions') continue;
    tables[name] = (rows || []).map((row) => {
      const copy = { ...row };
      if (name === 'agent_tokens') {
        copy.token_hash = '[redacted]';
      }
      if (name === 'shops' && 'phone' in copy) {
        copy.phone = maskPhone(copy.phone);
      }
      return copy;
    });
  }
  return { ...payload, tables };
}

export function assertSafeRestoreTarget(target: string, nodeEnv: string): void {
  const normalized = target.replace(/\\/g, '/');
  if (nodeEnv === 'production') {
    throw new Error('NODE_ENV=production 时拒绝 restore 脚本（防止误写生产）');
  }
  if (normalized === '/data' || normalized.startsWith('/data/')) {
    throw new Error('拒绝写入 /data/（生产路径）。请指定临时目录，例如 /tmp/feimaocat-restore.db');
  }
}

export function assertNoDevOpenids(
  users: Array<Record<string, unknown>>,
  prefix = 'dev_'
): void {
  const bad = users.filter((u) => String(u.openid || '').startsWith(prefix));
  if (bad.length) {
    throw new Error(`快照含 ${bad.length} 个 ${prefix} 开发账号，拒绝恢复`);
  }
}
