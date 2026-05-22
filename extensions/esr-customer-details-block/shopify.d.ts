import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Block.tsx' {
  const shopify: import('@shopify/ui-extensions/pos.customer-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/EditAction.tsx' {
  const shopify: import('@shopify/ui-extensions/pos.customer-details.action.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared/api.ts' {
  const shopify:
    | import('@shopify/ui-extensions/pos.customer-details.block.render').Api
    | import('@shopify/ui-extensions/pos.customer-details.action.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared/badges.ts' {
  const shopify:
    | import('@shopify/ui-extensions/pos.customer-details.block.render').Api
    | import('@shopify/ui-extensions/pos.customer-details.action.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared/types.ts' {
  const shopify:
    | import('@shopify/ui-extensions/pos.customer-details.block.render').Api
    | import('@shopify/ui-extensions/pos.customer-details.action.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/shared/config.ts' {
  const shopify:
    | import('@shopify/ui-extensions/pos.customer-details.block.render').Api
    | import('@shopify/ui-extensions/pos.customer-details.action.render').Api;
  const globalThis: { shopify: typeof shopify };
}
