import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Block.tsx' {
  const shopify: import('@shopify/ui-extensions/pos.product-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared/api.ts' {
  const shopify: import('@shopify/ui-extensions/pos.product-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared/types.ts' {
  const shopify: import('@shopify/ui-extensions/pos.product-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared/config.ts' {
  const shopify: import('@shopify/ui-extensions/pos.product-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
