export interface ScannedProduct {
  name: string;
  brand: string;
  price: number;
  currency: string;
  description: string;
}

export interface BasketItem {
  product: ScannedProduct;
  qty: number;
}
