import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { loginWithWxCode, resolveSession } from './auth.js';
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
    res.json({ ok: true });
  });

  app.get('/api/media/proxy', async (req, res, next) => {
    try {
      const { fetchProxiedImage } = await import('./services/media-proxy.js');
      const raw = String(req.query.url || '');
      const image = await fetchProxiedImage(raw);
      if (!image) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(image.buffer);
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/auth/login',
    asyncHandler(async (req, res) => {
      const code = String(req.body?.code || '');
      const { token, user } = await loginWithWxCode(code);
      res.json({
        token,
        user: {
          id: user.id,
          nickname: user.nickname,
          avatar: user.avatar,
        },
      });
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
      const visibility =
        req.body?.visibility === 'circles' ? 'circles' : 'private';
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
