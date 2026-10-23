'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Shop {
  shopId: number;
  title: string;
  lat: number;
  lng: number;
  category: string;
  avgPrice: string;
  fiveScore: number;
}

interface MapProps {
  shops: Shop[];
}

export default function Map({ shops }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const validShops = shops.filter(s => s.lat && s.lng && s.lat !== 0 && s.lng !== 0);

    if (mapRef.current) {
      mapRef.current.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
          mapRef.current?.removeLayer(layer);
        }
      });

      if (validShops.length > 0) {
        const bounds = L.latLngBounds(validShops.map(s => [s.lat, s.lng]));
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });

        validShops.forEach((shop) => {
          const marker = L.marker([shop.lat, shop.lng], {
            icon: L.divIcon({
              className: 'custom-marker',
              html: `<div style="background: #ef4444; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">📍</div>`,
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            })
          });

          marker.bindPopup(`
            <div style="min-width: 200px;">
              <strong style="font-size: 14px;">${shop.title}</strong><br/>
              <div style="margin-top: 4px; font-size: 12px; color: #666;">
                ${shop.category}<br/>
                评分：${shop.fiveScore.toFixed(1)} ⭐<br/>
                人均：${shop.avgPrice}
              </div>
            </div>
          `);

          marker.addTo(mapRef.current!);
        });
      }
    } else {
      const centerLat = validShops.length > 0
        ? validShops.reduce((sum, s) => sum + s.lat, 0) / validShops.length
        : 22.63;
      const centerLng = validShops.length > 0
        ? validShops.reduce((sum, s) => sum + s.lng, 0) / validShops.length
        : 114.06;

      const map = L.map(mapContainerRef.current).setView([centerLat, centerLng], 13);

      L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        attribution: '© 高德地图 (GCJ-02坐标系)',
        subdomains: ['1', '2', '3', '4'],
        maxZoom: 18
      }).addTo(map);

      validShops.forEach((shop) => {
        const marker = L.marker([shop.lat, shop.lng], {
          icon: L.divIcon({
            className: 'custom-marker',
            html: `<div style="background: #ef4444; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">📍</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          })
        });

        marker.bindPopup(`
          <div style="min-width: 200px;">
            <strong style="font-size: 14px;">${shop.title}</strong><br/>
            <div style="margin-top: 4px; font-size: 12px; color: #666;">
              ${shop.category}<br/>
              评分：${shop.fiveScore.toFixed(1)} ⭐<br/>
              人均：${shop.avgPrice}
            </div>
          </div>
        `);

        marker.addTo(map);
      });

      if (validShops.length > 0) {
        const bounds = L.latLngBounds(validShops.map(s => [s.lat, s.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current && shops.length === 0) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [shops]);

  return (
    <div>
      <div ref={mapContainerRef} style={{ height: '400px', width: '100%', borderRadius: '8px' }} />
      <p className="text-xs text-gray-500 mt-2">
        地图坐标系与大众点评一致，可直接对照打点
      </p>
    </div>
  );
}
