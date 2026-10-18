#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { parseAlbumUrl, fetchAlbumData } from '../lib/fetcher.js';
import { saveAlbum, saveShop, getShopsByAlbum, listShops, getShop, getShopsNear } from '../lib/db.js';

const server = new Server(
  {
    name: 'opendianping-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools: Tool[] = [
  {
    name: 'import_album',
    description: '导入大众点评收藏专辑。输入专辑分享链接，系统会解析并保存所有店铺数据到本地数据库。',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '大众点评收藏专辑分享链接，如 https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807',
        },
        use_fixtures: {
          type: 'boolean',
          description: '是否使用离线数据（默认 false，设为 true 时使用本地样本数据，无需网络）',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_shops',
    description: '列出店铺列表，支持按价格、评分、类目筛选。返回店铺详细信息包括名称、地址、评分、推荐菜等。',
    inputSchema: {
      type: 'object',
      properties: {
        album_id: {
          type: 'number',
          description: '专辑 ID（可选，不提供则返回所有店铺）',
        },
        min_price: {
          type: 'number',
          description: '最低人均价格（可选）',
        },
        max_price: {
          type: 'number',
          description: '最高人均价格（可选）',
        },
        min_score: {
          type: 'number',
          description: '最低评分 0-5（可选）',
        },
        category: {
          type: 'string',
          description: '类目关键词筛选（可选），如"咖啡"、"小吃"',
        },
      },
    },
  },
  {
    name: 'get_shop',
    description: '获取单个店铺的详细信息，包括坐标、推荐菜、标签、推荐理由等完整数据。',
    inputSchema: {
      type: 'object',
      properties: {
        shop_id: {
          type: 'number',
          description: '店铺 ID（shopId）',
        },
      },
      required: ['shop_id'],
    },
  },
  {
    name: 'shops_near',
    description: '搜索指定坐标附近的店铺（使用 GCJ-02 坐标系），返回按距离排序的店铺列表。',
    inputSchema: {
      type: 'object',
      properties: {
        lat: {
          type: 'number',
          description: '纬度（GCJ-02 坐标系）',
        },
        lng: {
          type: 'number',
          description: '经度（GCJ-02 坐标系）',
        },
        radius_km: {
          type: 'number',
          description: '搜索半径（公里），默认 5km',
          default: 5,
        },
      },
      required: ['lat', 'lng'],
    },
  },
  {
    name: 'plan_route',
    description: '规划顺路探店路线。根据起点和目标店铺列表，按地理位置规划最优访问顺序（最近邻算法）。',
    inputSchema: {
      type: 'object',
      properties: {
        shop_ids: {
          type: 'array',
          items: { type: 'number' },
          description: '要访问的店铺 ID 列表',
        },
        start_lat: {
          type: 'number',
          description: '起点纬度（GCJ-02）',
        },
        start_lng: {
          type: 'number',
          description: '起点经度（GCJ-02）',
        },
      },
      required: ['shop_ids', 'start_lat', 'start_lng'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'import_album': {
        const url = args.url as string;
        const useFixtures = (args.use_fixtures as boolean) || false;

        const albumId = parseAlbumUrl(url);
        if (!albumId) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: '无法解析专辑 ID' }, null, 2),
              },
            ],
          };
        }

        const { album, shops } = await fetchAlbumData(albumId, useFixtures);

        saveAlbum(album);
        for (const shop of shops) {
          saveShop(shop);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  album_id: albumId,
                  shop_count: shops.length,
                  album_title: album.title,
                  message: `成功导入专辑「${album.title}」，共 ${shops.length} 家店铺`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'list_shops': {
        const albumId = args.album_id as number | undefined;
        const filters: any = {};

        if (args.min_price) filters.minPrice = args.min_price as number;
        if (args.max_price) filters.maxPrice = args.max_price as number;
        if (args.min_score) filters.minScore = args.min_score as number;
        if (args.category) filters.category = args.category as string;

        let shops;
        if (albumId) {
          shops = getShopsByAlbum(albumId);
        } else {
          shops = listShops(filters);
        }

        if (Object.keys(filters).length > 0) {
          shops = shops.filter((shop) => {
            if (filters.minPrice && shop.priceNumber < filters.minPrice) return false;
            if (filters.maxPrice && shop.priceNumber > filters.maxPrice) return false;
            if (filters.minScore && shop.fiveScore < filters.minScore) return false;
            if (filters.category && !shop.category.toLowerCase().includes(filters.category.toLowerCase())) return false;
            return true;
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  count: shops.length,
                  shops: shops.map((s) => ({
                    shop_id: s.shopId,
                    title: s.title,
                    city: s.city,
                    category: s.category,
                    region: s.region,
                    avg_price: s.avgPrice,
                    price_number: s.priceNumber,
                    five_score: s.fiveScore,
                    star: s.star,
                    review_count: s.reviewCount,
                    rec_reason: s.recReason,
                    rec_dishes: s.recDishes,
                    tags: s.tags,
                    lat: s.lat,
                    lng: s.lng,
                    web_url: s.webUrl,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get_shop': {
        const shopId = args.shop_id as number;
        const shop = getShop(shopId);

        if (!shop) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: '店铺不存在' }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  shop: {
                    shop_id: shop.shopId,
                    uuid: shop.uuid,
                    title: shop.title,
                    city: shop.city,
                    city_id: shop.cityId,
                    category: shop.category,
                    region: shop.region,
                    avg_price: shop.avgPrice,
                    price_number: shop.priceNumber,
                    five_score: shop.fiveScore,
                    star: shop.star,
                    review_count: shop.reviewCount,
                    review_number: shop.reviewNumber,
                    rec_reason: shop.recReason,
                    rec_dishes: shop.recDishes,
                    tags: shop.tags,
                    head_img: shop.headImg,
                    web_url: shop.webUrl,
                    lat: shop.lat,
                    lng: shop.lng,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'shops_near': {
        const lat = args.lat as number;
        const lng = args.lng as number;
        const radiusKm = (args.radius_km as number) || 5;

        const shops = getShopsNear(lat, lng, radiusKm);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  count: shops.length,
                  search_center: { lat, lng },
                  radius_km: radiusKm,
                  shops: shops.map((s: any) => ({
                    shop_id: s.shopId,
                    title: s.title,
                    category: s.category,
                    region: s.region,
                    avg_price: s.avgPrice,
                    five_score: s.fiveScore,
                    lat: s.lat,
                    lng: s.lng,
                    distance_km: s.distance?.toFixed(2),
                    web_url: s.webUrl,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'plan_route': {
        const shopIds = args.shop_ids as number[];
        const startLat = args.start_lat as number;
        const startLng = args.start_lng as number;

        const shops = shopIds.map((id) => getShop(id)).filter((s) => s !== null);

        if (shops.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: '没有找到任何店铺' }, null, 2),
              },
            ],
          };
        }

        const distance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
          const R = 6371;
          const dLat = ((lat2 - lat1) * Math.PI) / 180;
          const dLng = ((lng2 - lng1) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };

        const route: any[] = [];
        const remaining = [...shops];
        let currentLat = startLat;
        let currentLng = startLng;
        let totalDistance = 0;

        while (remaining.length > 0) {
          let nearest = remaining[0];
          let nearestIndex = 0;
          let nearestDistance = distance(currentLat, currentLng, nearest.lat, nearest.lng);

          for (let i = 1; i < remaining.length; i++) {
            const d = distance(currentLat, currentLng, remaining[i].lat, remaining[i].lng);
            if (d < nearestDistance) {
              nearest = remaining[i];
              nearestIndex = i;
              nearestDistance = d;
            }
          }

          totalDistance += nearestDistance;
          route.push({
            shop_id: nearest.shopId,
            title: nearest.title,
            category: nearest.category,
            avg_price: nearest.avgPrice,
            five_score: nearest.fiveScore,
            lat: nearest.lat,
            lng: nearest.lng,
            distance_from_previous_km: nearestDistance.toFixed(2),
            rec_dishes: nearest.recDishes,
            web_url: nearest.webUrl,
          });

          currentLat = nearest.lat;
          currentLng = nearest.lng;
          remaining.splice(nearestIndex, 1);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  start_point: { lat: startLat, lng: startLng },
                  total_shops: route.length,
                  total_distance_km: totalDistance.toFixed(2),
                  route,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: '未知工具' }, null, 2),
            },
          ],
        };
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: error.message || '执行失败' }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OpenDianping MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
