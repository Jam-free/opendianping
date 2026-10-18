'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Download, MapPin, Star, TrendingUp } from 'lucide-react';

const MapComponent = dynamic(() => import('@/components/Map'), { ssr: false });

interface Shop {
  shopId: number;
  title: string;
  city: string;
  category: string;
  region: string;
  avgPrice: string;
  priceNumber: number;
  fiveScore: number;
  star: number;
  reviewCount: string;
  recReason: string;
  tags: string[];
  headImg: string;
  webUrl: string;
  lat: number;
  lng: number;
  recDishes: string[];
}

interface Album {
  albumId: number;
  title: string;
  shopCount: number;
  authorName: string;
}

export default function Home() {
  const [url, setUrl] = useState('https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807');
  const [loading, setLoading] = useState(false);
  const [album, setAlbum] = useState<Album | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [filteredShops, setFilteredShops] = useState<Shop[]>([]);
  const [error, setError] = useState('');
  const [useFixtures, setUseFixtures] = useState(false);
  
  const [filters, setFilters] = useState({
    minPrice: '',
    maxPrice: '',
    minScore: '',
    category: '',
    sortBy: 'default'
  });

  const handleImport = async () => {
    if (!url.trim()) {
      setError('请输入专辑链接');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, useFixtures })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '导入失败');
      }

      await loadShops(data.albumId);
    } catch (err: any) {
      setError(err.message || '导入失败，请检查网络连接或使用离线模式');
    } finally {
      setLoading(false);
    }
  };

  const loadShops = async (albumId: number) => {
    try {
      const response = await fetch(`/api/shops?albumId=${albumId}`);
      const data = await response.json();

      if (data.success) {
        setAlbum(data.album);
        setShops(data.shops);
        setFilteredShops(data.shops);
      }
    } catch (err) {
      console.error('Failed to load shops:', err);
    }
  };

  useEffect(() => {
    let filtered = [...shops];

    if (filters.minPrice) {
      filtered = filtered.filter(s => s.priceNumber >= parseFloat(filters.minPrice));
    }
    if (filters.maxPrice) {
      filtered = filtered.filter(s => s.priceNumber <= parseFloat(filters.maxPrice));
    }
    if (filters.minScore) {
      filtered = filtered.filter(s => s.fiveScore >= parseFloat(filters.minScore));
    }
    if (filters.category) {
      filtered = filtered.filter(s =>
        s.category.toLowerCase().includes(filters.category.toLowerCase())
      );
    }

    if (filters.sortBy === 'price-asc') {
      filtered.sort((a, b) => a.priceNumber - b.priceNumber);
    } else if (filters.sortBy === 'price-desc') {
      filtered.sort((a, b) => b.priceNumber - a.priceNumber);
    } else if (filters.sortBy === 'score-desc') {
      filtered.sort((a, b) => b.fiveScore - a.fiveScore);
    } else if (filters.sortBy === 'reviews-desc') {
      filtered.sort((a, b) => {
        const aNum = parseInt(a.reviewCount) || 0;
        const bNum = parseInt(b.reviewCount) || 0;
        return bNum - aNum;
      });
    }

    setFilteredShops(filtered);
  }, [filters, shops]);

  const handleExport = async (format: 'csv' | 'json') => {
    if (!album) return;

    const url = `/api/export?albumId=${album.albumId}&format=${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `shops_${album.albumId}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderStars = (star: number) => {
    const fullStars = Math.floor(star / 10);
    const hasHalf = (star % 10) >= 5;
    return (
      <span className="text-yellow-500">
        {'★'.repeat(fullStars)}
        {hasHalf && '☆'}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">开放大众点评</h1>
          <p className="text-gray-600 mt-1">把收藏专辑数据放出来，让你的AI能用</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                粘贴大众点评收藏专辑链接
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
              />
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handleImport}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '导入中...' : '导入专辑'}
              </button>

              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={useFixtures}
                  onChange={(e) => setUseFixtures(e.target.checked)}
                  className="rounded"
                />
                使用离线数据（无需网络）
              </label>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        {album && (
          <>
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{album.title}</h2>
                  <p className="text-gray-600 mt-1">
                    {album.shopCount} 家店铺 · 作者：{album.authorName}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleExport('csv')}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Download size={20} />
                    导出 CSV
                  </button>
                  <button
                    onClick={() => handleExport('json')}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <Download size={20} />
                    导出 JSON
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <h3 className="font-semibold text-gray-900 mb-4">筛选条件</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        价格范围
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="最低"
                          value={filters.minPrice}
                          onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
                        />
                        <input
                          type="number"
                          placeholder="最高"
                          value={filters.maxPrice}
                          onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        最低评分
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="5"
                        placeholder="0-5"
                        value={filters.minScore}
                        onChange={(e) => setFilters({ ...filters, minScore: e.target.value })}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        类目搜索
                      </label>
                      <input
                        type="text"
                        placeholder="如：咖啡、小吃"
                        value={filters.category}
                        onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        排序方式
                      </label>
                      <select
                        value={filters.sortBy}
                        onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
                      >
                        <option value="default">默认顺序</option>
                        <option value="price-asc">价格从低到高</option>
                        <option value="price-desc">价格从高到低</option>
                        <option value="score-desc">评分从高到低</option>
                        <option value="reviews-desc">评论数从多到少</option>
                      </select>
                    </div>

                    <button
                      onClick={() => setFilters({
                        minPrice: '',
                        maxPrice: '',
                        minScore: '',
                        category: '',
                        sortBy: 'default'
                      })}
                      className="w-full px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                    >
                      清除筛选
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-4">
                  <h3 className="font-semibold text-gray-900 mb-2">统计信息</h3>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>显示 {filteredShops.length} / {shops.length} 家店铺</p>
                    {filteredShops.length > 0 && (
                      <>
                        <p>平均评分：{(filteredShops.reduce((sum, s) => sum + s.fiveScore, 0) / filteredShops.length).toFixed(1)}</p>
                        <p>平均价格：¥{Math.round(filteredShops.reduce((sum, s) => sum + s.priceNumber, 0) / filteredShops.length)}</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-3 space-y-6">
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <MapPin size={20} />
                    地图分布（GCJ-02坐标）
                  </h3>
                  <MapComponent shops={filteredShops} />
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">店铺列表</h3>
                  {filteredShops.map((shop) => (
                    <div key={shop.shopId} className="bg-white rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow">
                      <div className="flex gap-4">
                        {shop.headImg && (
                          <img
                            src={shop.headImg}
                            alt={shop.title}
                            className="w-24 h-24 rounded-lg object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h4 className="text-lg font-semibold text-gray-900">{shop.title}</h4>
                              <div className="flex items-center gap-3 mt-1 text-sm text-gray-600">
                                <span>{shop.city}</span>
                                <span>·</span>
                                <span>{shop.category}</span>
                                <span>·</span>
                                <span>{shop.region}</span>
                              </div>
                            </div>
                            <a
                              href={shop.webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 text-sm text-blue-600 border border-blue-600 rounded hover:bg-blue-50 transition-colors whitespace-nowrap"
                            >
                              查看详情
                            </a>
                          </div>

                          <div className="flex items-center gap-4 mt-3">
                            <div className="flex items-center gap-1">
                              <Star size={16} className="text-yellow-500" />
                              <span className="font-semibold">{shop.fiveScore.toFixed(1)}</span>
                              <span className="text-sm text-gray-500">({shop.reviewCount})</span>
                            </div>
                            {renderStars(shop.star)}
                            <span className="text-sm text-gray-600">人均 {shop.avgPrice}</span>
                          </div>

                          {shop.recReason && (
                            <div className="mt-3 text-sm text-gray-700 bg-amber-50 px-3 py-2 rounded">
                              <TrendingUp size={14} className="inline mr-1" />
                              {shop.recReason}
                            </div>
                          )}

                          {shop.recDishes.length > 0 && (
                            <div className="mt-3">
                              <span className="text-sm font-medium text-gray-700">推荐菜：</span>
                              <span className="text-sm text-gray-600">
                                {shop.recDishes.slice(0, 5).join('、')}
                              </span>
                            </div>
                          )}

                          {shop.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">
                              {shop.tags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {filteredShops.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      没有符合条件的店铺
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
