-- 美食肥猫 · 云托管 MySQL 建表（utf8mb4 / InnoDB）
-- 可在「数据库管理」控制台粘贴执行。应用启动时也会 CREATE TABLE IF NOT EXISTS，不必手工跑完才能发版。
-- 不要 DROP 这些表。不要 DELETE FROM agent_tokens / favorites。

CREATE DATABASE IF NOT EXISTS feimaocat
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE feimaocat;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  openid VARCHAR(191) NOT NULL,
  unionid VARCHAR(191) NULL,
  nickname TEXT NULL,
  avatar TEXT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (token),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shops (
  id VARCHAR(64) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_shop_id VARCHAR(191) NULL,
  amap_poi_id VARCHAR(191) NULL,
  raw_name TEXT NOT NULL,
  adcode VARCHAR(32) NULL,
  category TEXT NULL,
  district TEXT NULL,
  city VARCHAR(64) NULL,
  address TEXT NULL,
  avg_price VARCHAR(64) NULL,
  lat DOUBLE NULL,
  lng DOUBLE NULL,
  source_url TEXT NULL,
  head_img TEXT NULL,
  phone VARCHAR(64) NULL,
  display_cache_policy VARCHAR(32) NOT NULL DEFAULT 'minimal',
  PRIMARY KEY (id),
  KEY idx_shops_source (source_shop_id),
  KEY idx_shops_amap (amap_poi_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_batches (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_url TEXT NULL,
  albumid VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  counts TEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_import_batches_user (user_id),
  CONSTRAINT fk_import_batches_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS favorites (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  shop_id VARCHAR(64) NOT NULL,
  note TEXT NULL,
  visibility VARCHAR(32) NOT NULL DEFAULT 'private',
  import_batch_id VARCHAR(64) NULL,
  created_at VARCHAR(40) NOT NULL,
  photo_url TEXT NULL,
  wishlist TINYINT(1) NOT NULL DEFAULT 0,
  from_user_id VARCHAR(64) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_favorites_user_shop (user_id, shop_id),
  KEY idx_favorites_user (user_id),
  KEY idx_favorites_visibility (visibility),
  CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_favorites_shop FOREIGN KEY (shop_id) REFERENCES shops(id),
  CONSTRAINT fk_favorites_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS circles (
  id VARCHAR(64) NOT NULL,
  name TEXT NOT NULL,
  owner_id VARCHAR(64) NOT NULL,
  invite_token VARCHAR(64) NOT NULL,
  token_expires_at VARCHAR(40) NOT NULL,
  opengid VARCHAR(191) NULL,
  member_limit INT NOT NULL DEFAULT 200,
  is_personal TINYINT(1) NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_circles_owner (owner_id),
  CONSTRAINT fk_circles_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  joined_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (circle_id, user_id),
  KEY idx_circle_members_user (user_id),
  CONSTRAINT fk_circle_members_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  CONSTRAINT fk_circle_members_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS circle_shares (
  circle_id VARCHAR(64) NOT NULL,
  favorite_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (circle_id, favorite_id),
  CONSTRAINT fk_circle_shares_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  CONSTRAINT fk_circle_shares_fav FOREIGN KEY (favorite_id) REFERENCES favorites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_tokens (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  token_prefix VARCHAR(32) NOT NULL,
  last_used_at VARCHAR(40) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_agent_tokens_user (user_id),
  CONSTRAINT fk_agent_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shop_comments (
  id VARCHAR(64) NOT NULL,
  shop_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  body TEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_shop_comments_shop (shop_id, created_at),
  CONSTRAINT fk_shop_comments_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  CONSTRAINT fk_shop_comments_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
