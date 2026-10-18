export interface Album {
  albumId: number;
  title: string;
  shopCount: number;
  contentCount: number;
  createTime: number;
  latestModifyTime: number;
  authorName: string;
  authorId: number;
}

export interface Shop {
  shopId: number;
  uuid: string;
  title: string;
  cityId: number;
  city: string;
  category: string;
  region: string;
  avgPrice: string;
  priceNumber: number;
  fiveScore: number;
  star: number;
  reviewCount: string;
  reviewNumber: number;
  recReason: string;
  tags: string[];
  headImg: string;
  webUrl: string;
  lat: number;
  lng: number;
  recDishes: string[];
  albumId: number;
}

export interface DianpingAPIResponse {
  records: Array<{
    showType: number;
    favorList?: any[];
    collectItemList?: any[];
    nextStart: string;
    isEnd: boolean;
  }>;
  favorAlbumItem: any;
}
