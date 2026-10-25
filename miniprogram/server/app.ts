import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { loginWithWxCode, resolveSession } from './auth.js';
import { config } from './config.js';
import {
  parseImport,
  saveImportSelection,
  undoImportBatch,
} from './services/import.js';
import {
  deleteFavorite,
  listFavorites,
  updateFavorite,
} from './services/favorites.js';
import * as circles from './services/circles.js';
import * as network from './services/network.js';

export type AuthedRequest = Request & {
  userId?: string;
  openid?: string;
};

function asyncHandler(
  fn: (req: AuthedRequest, res: Response) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthedRequest, res).catch(next);
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const session = resolveSession(req.header('authorization') || undefined);
  if (!session) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  req.userId = session.userId;
  req.openid = session.openid;
  next();
}

function requireAgentAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const session = network.resolveAgentToken(
    req.header('authorization') || undefined
  );
  if (!session) {
    res.status(401).json({ error: '无效的 Agent Token' });
    return;
  }
  req.userId = session.userId;
  next();
}

function sendError(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  const status = e.status || 500;
  res.status(status).json({ error: e.message || '服务器错误' });
}

/**
 * Express 应用工厂：测试可直接注入，不监听端口。
 */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    // albumImport=true 表示本镜像可解析点评公开专辑（不依赖根目录 lib）
    res.json({ ok: true, albumImport: true });
  });

  app.get(
    '/api/geo/reverse',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { reverseGeocode } = await import('./services/geo.js');
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      res.json(await reverseGeocode(lat, lng));
    })
  );

  /**
   * 图片代理：上游失败也返回 200 占位图，避免小程序 image 反复 404 刷屏。
   * 产品意图：图挂了就静默浅色块，列表仍可读；客户端另有本地兜底图。
   */
  app.get('/api/media/proxy', async (req, res, next) => {
    try {
      const {
        fetchProxiedImage,
        fallbackPlaceholderImage,
      } = await import('./services/media-proxy.js');
      const raw = String(req.query.url || '');
      const image =
        (await fetchProxiedImage(raw)) || fallbackPlaceholderImage();
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(200).send(image.buffer);
    } catch (err) {
      next(err);
    }
  });

  /** 登录页用来区分「微信登录」vs「一键进入」文案；不鉴权 */
  app.get('/api/auth/bootstrap', (_req, res) => {
    res.json({ bypass: config.devAuthBypass });
  });

  app.post(
    '/api/auth/login',
    asyncHandler(async (req, res) => {
      const code = String(req.body?.code || '');
      const { token, user } = await loginWithWxCode(code);
      // 登录后静默确保个人美食网，前端不再出现「创建圈子」
      const net = await network.ensurePersonalNetwork(user.id);
      res.json({
        token,
        user: {
          id: user.id,
          nickname: user.nickname,
          avatar: user.avatar,
        },
        networkId: net.id,
      });
    })
  );

  /** 撤销本机会话：清服务端 token，客户端再清本地票 */
  app.post(
    '/api/auth/logout',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { revokeSession } = await import('./auth.js');
      const authHeader = req.header('authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      revokeSession(token);
      res.json({ ok: true });
    })
  );

  app.get(
    '/api/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const profile = network.getUserProfile(req.userId!);
      const net = await network.ensurePersonalNetwork(req.userId!);
      res.json({ user: profile, networkId: net.id });
    })
  );

  app.patch(
    '/api/me/profile',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = network.updateUserProfile(req.userId!, {
        nickname: req.body?.nickname ? String(req.body.nickname) : undefined,
        avatar: req.body?.avatar ? String(req.body.avatar) : undefined,
      });
      res.json({ user });
    })
  );

  app.get(
    '/api/me/network',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await network.listFoodFriends(req.userId!));
    })
  );

  app.get(
    '/api/me/shops',
    requireAuth,
    asyncHandler(async (req, res) => {
      const lat = req.query.lat ? Number(req.query.lat) : undefined;
      const lng = req.query.lng ? Number(req.query.lng) : undefined;
      res.json(
        await network.listMyShops(req.userId!, {
          lat: Number.isFinite(lat) ? lat : undefined,
          lng: Number.isFinite(lng) ? lng : undefined,
          userCity: req.query.userCity ? String(req.query.userCity) : undefined,
        })
      );
    })
  );

  app.post(
    '/api/me/checkins',
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = await network.createCheckin(req.userId!, {
        name: String(req.body?.name || ''),
        note: req.body?.note ? String(req.body.note) : undefined,
        lat: Number(req.body?.lat),
        lng: Number(req.body?.lng),
        address: req.body?.address ? String(req.body.address) : undefined,
        photoUrl: req.body?.photoUrl ? String(req.body.photoUrl) : undefined,
      });
      res.json(result);
    })
  );

  app.get(
    '/api/agent-tokens',
    requireAuth,
    asyncHandler(async (req, res) => {
      const meta = network.getAgentTokenMeta(req.userId!);
      res.json({ token: meta || null });
    })
  );

  app.post(
    '/api/agent-tokens',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(network.issueAgentToken(req.userId!));
    })
  );

  app.post(
    '/api/agent-tokens/reset',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(network.issueAgentToken(req.userId!));
    })
  );

  app.get(
    '/api/agent/shops',
    requireAgentAuth,
    asyncHandler(async (req, res) => {
      res.json(await network.listAgentShops(req.userId!));
    })
  );

  app.get(
    '/api/agent/friends',
    requireAgentAuth,
    asyncHandler(async (req, res) => {
      res.json(await network.listAgentFriends(req.userId!));
    })
  );

  app.post(
    '/api/import/parse',
    requireAuth,
    asyncHandler(async (req, res) => {
      const text = String(req.body?.text || req.body?.url || '').trim();
      if (!text) {
        res.status(400).json({ error: '请粘贴专辑链接或文本' });
        return;
      }
      const result = await parseImport(req.userId!, {
        text,
        sourceUrl: text,
        useFixtures: Boolean(req.body?.useFixtures),
      });
      res.json(result);
    })
  );

  app.post(
    '/api/import/save',
    requireAuth,
    asyncHandler(async (req, res) => {
      const previewId = String(req.body?.previewId || '');
      const selectedIndexes = Array.isArray(req.body?.selectedIndexes)
        ? req.body.selectedIndexes.map((n: unknown) => Number(n))
        : [];
      // 默认对美食好友可见；显式传 private 才仅自己
      const visibility =
        req.body?.visibility === 'private' ? 'private' : 'circles';
      const shareToCircleIds = Array.isArray(req.body?.shareToCircleIds)
        ? req.body.shareToCircleIds.map(String)
        : undefined;
      const result = saveImportSelection({
        userId: req.userId!,
        previewId,
        selectedIndexes,
        visibility,
        shareToCircleIds,
      });
      res.json({
        ...result,
        message: `成功 ${result.success} / 重复 ${result.duplicate} / 失败 ${result.failed}`,
      });
    })
  );

  app.delete(
    '/api/import/batches/:batchId',
    requireAuth,
    asyncHandler(async (req, res) => {
      const removed = undoImportBatch(req.userId!, req.params.batchId);
      res.json({ removed });
    })
  );

  app.get(
    '/api/favorites',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ items: listFavorites(req.userId!) });
    })
  );

  app.patch(
    '/api/favorites/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      updateFavorite(req.userId!, req.params.id, {
        visibility: req.body?.visibility,
        note: req.body?.note,
      });
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/favorites/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      deleteFavorite(req.userId!, req.params.id);
      res.json({ ok: true });
    })
  );

  app.get(
    '/api/circles',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ items: listMyCirclesSafe(req.userId!) });
    })
  );

  app.post(
    '/api/circles',
    requireAuth,
    asyncHandler(async (req, res) => {
      const circle = await circles.createCircle(
        req.userId!,
        String(req.body?.name || '')
      );
      res.json(circle);
    })
  );

  app.get(
    '/api/circles/:id/preview',
    requireAuth,
    asyncHandler(async (req, res) => {
      // 加入页：未入圈也可看公开圈信息（不含店铺）
      res.json(circles.getCirclePublicInfo(req.params.id));
    })
  );

  app.post(
    '/api/circles/:id/join',
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = circles.joinCircle(
        req.userId!,
        req.params.id,
        String(req.body?.token || ''),
        req.body?.opengid ? String(req.body.opengid) : undefined
      );
      res.json(result);
    })
  );

  app.post(
    '/api/circles/:id/reset-invite',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(circles.resetInviteToken(req.userId!, req.params.id));
    })
  );

  app.patch(
    '/api/circles/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(
        await circles.renameCircle(
          req.userId!,
          req.params.id,
          String(req.body?.name || '')
        )
      );
    })
  );

  app.post(
    '/api/circles/:id/leave',
    requireAuth,
    asyncHandler(async (req, res) => {
      circles.leaveCircle(req.userId!, req.params.id);
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/circles/:id/members/:memberId',
    requireAuth,
    asyncHandler(async (req, res) => {
      circles.removeMember(req.userId!, req.params.id, req.params.memberId);
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/circles/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      circles.dissolveCircle(req.userId!, req.params.id);
      res.json({ ok: true });
    })
  );

  app.get(
    '/api/circles/:id/shops',
    requireAuth,
    asyncHandler(async (req, res) => {
      const lat = req.query.lat ? Number(req.query.lat) : undefined;
      const lng = req.query.lng ? Number(req.query.lng) : undefined;
      const result = circles.listCircleShops(req.userId!, req.params.id, {
        city: req.query.city ? String(req.query.city) : undefined,
        memberId: req.query.memberId ? String(req.query.memberId) : undefined,
        category: req.query.category ? String(req.query.category) : undefined,
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
        userCity: req.query.userCity ? String(req.query.userCity) : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      });
      res.json(result);
    })
  );

  app.get(
    '/api/circles/:id/shops/:poiKey',
    requireAuth,
    asyncHandler(async (req, res) => {
      const lat = req.query.lat ? Number(req.query.lat) : undefined;
      const lng = req.query.lng ? Number(req.query.lng) : undefined;
      const shop = circles.getCircleShopDetail(
        req.userId!,
        req.params.id,
        req.params.poiKey,
        {
          lat: Number.isFinite(lat) ? lat : undefined,
          lng: Number.isFinite(lng) ? lng : undefined,
          userCity: req.query.userCity ? String(req.query.userCity) : undefined,
        }
      );
      if (!shop) {
        res.status(404).json({ error: '店铺不在圈内或已移除' });
        return;
      }
      res.json({ shop });
    })
  );

  app.post(
    '/api/circles/:id/favorites',
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = circles.addFavoriteFromCircleShop(
        req.userId!,
        req.params.id,
        String(req.body?.poiKey || ''),
        String(req.body?.note || '')
      );
      res.json(result);
    })
  );

  app.get(
    '/api/circles/:id/members',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({
        items: circles.listCircleMembers(req.userId!, req.params.id),
      });
    })
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendError(res, err);
  });

  return app;
}

function listMyCirclesSafe(userId: string) {
  return circles.listMyCircles(userId);
}
