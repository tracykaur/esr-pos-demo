import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { currentLocationGid, postAi, toCustomerGid, type AiMode, type ProductRecommendation } from "./shared/api";

type Msg = { role: "user" | "assistant"; content: string; productRecommendations?: ProductRecommendation[] };

const modes: Array<{ id: AiMode; label: string }> = [
  { id: "CLIENTELING_COACH", label: "Coach" },
  { id: "PRODUCT_EXPERT", label: "Products" },
  { id: "PROMO_ADVISOR", label: "Perks" },
  { id: "OUTREACH_DRAFT", label: "Outreach" },
];

const quick: Record<AiMode, string[]> = {
  CLIENTELING_COACH: ["What should I say next?", "How do I personalise this visit?"],
  PRODUCT_EXPERT: ["What should I show with this cart?", "Why does this product fit?"],
  PROMO_ADVISOR: ["Which VIP or Concierge perks apply?", "How do I explain the discount?"],
  OUTREACH_DRAFT: ["Draft a follow-up SMS", "Draft a new-drop email"],
};

function readCart() {
  const cart = shopify.cart.current.value as unknown as {
    lineItems?: Array<{ title?: string; variantId?: string; quantity?: number }>;
    customer?: { id?: string | number } | null;
    customerId?: string | number | null;
  };
  return {
    items: (cart?.lineItems ?? []).map((item) => ({ title: item.title, variantId: item.variantId, quantity: item.quantity })),
    customerId: toCustomerGid(cart?.customer?.id ?? cart?.customerId),
  };
}

function ProductCards({ products }: { products: ProductRecommendation[] }) {
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  if (!products.length) return null;

  async function addToCart(product: ProductRecommendation, variantId: number | undefined) {
    if (!variantId) {
      shopify.toast.show("Choose a size before adding to cart");
      return;
    }
    const variant = product.variants.find((candidate) => candidate.id === variantId);
    if (variant && !variant.available) {
      shopify.toast.show(`${product.title} ${variant.title} is out of stock`);
      return;
    }
    try {
      const uuid = await shopify.cart.addLineItem(variantId, 1);
      if (uuid) shopify.toast.show(`Added ${product.title}${variant?.title && variant.title !== "Default" ? ` · ${variant.title}` : ""}`);
    } catch (err) {
      shopify.toast.show(`Could not add ${product.title}`);
    }
  }

  return (
    <s-stack direction="inline" gap="small">
      {products.map((product) => {
        const selectedVariantId = selectedVariants[product.id] ?? product.suggestedVariantId ?? product.variantId ?? product.variants[0]?.id;
        const selectedVariant = product.variants.find((variant) => variant.id === selectedVariantId);
        const hasSizeChoices = product.variants.length > 1 || (product.variants[0]?.title && product.variants[0].title !== "Default");
        return (
          <s-box key={product.id} padding="small" inlineSize="23%">
            <s-stack direction="block" gap="small">
              {product.imageUrl && (
                <s-box blockSize="96px" inlineSize="fill">
                  <s-image src={product.imageUrl} alt={product.altText ?? product.title} inlineSize="fill" objectFit="cover" />
                </s-box>
              )}
              <s-text type="strong">{product.title}</s-text>
              <s-text tone="neutral" type="small">
                {product.productType}{selectedVariant?.price ? ` · $${selectedVariant.price}` : product.price ? ` · $${product.price}` : ""}
              </s-text>
              {product.suggestedSize && selectedVariant && (
                <s-text tone="info" type="small">Suggested size: {selectedVariant.title}</s-text>
              )}
              {hasSizeChoices && (
                <s-stack direction="inline" gap="small">
                  {product.variants.map((variant) => (
                    <s-button
                      key={variant.id}
                      variant={variant.id === selectedVariantId ? "primary" : "secondary"}
                      disabled={!variant.available}
                      onClick={() => setSelectedVariants((current) => ({ ...current, [product.id]: variant.id }))}
                    >
                      {variant.title}
                    </s-button>
                  ))}
                </s-stack>
              )}
              <s-button variant="primary" onClick={() => addToCart(product, selectedVariantId)} disabled={!selectedVariantId || selectedVariant?.available === false}>
                Add {selectedVariant?.title && selectedVariant.title !== "Default" ? selectedVariant.title : "to cart"}
              </s-button>
            </s-stack>
          </s-box>
        );
      })}
    </s-stack>
  );
}

function Modal() {
  const [mode, setMode] = useState<AiMode>("CLIENTELING_COACH");
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: "Ask me for Elka styling guidance, VIP/Concierge perks, product ideas, or outreach drafts." }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState(readCart());

  useEffect(() => shopify.cart.current.subscribe(() => setCart(readCart())), []);

  const send = useCallback(async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setLoading(true);
    try {
      const res = await postAi({ message, mode, cartItems: cart.items, customerId: cart.customerId, locationId: currentLocationGid() });
      setMessages((prev) => [...prev, { role: "assistant", content: res.content, productRecommendations: res.productRecommendations }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `AI error: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setLoading(false);
    }
  }, [cart, input, loading, mode]);

  return (
    <s-page heading="ESR AI Assistant">
      <s-scroll-box>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
          <s-section heading="Mode">
            <s-stack direction="inline" gap="small">
              {modes.map((m) => (
                <s-button key={m.id} variant={mode === m.id ? "primary" : "secondary"} onClick={() => setMode(m.id)}>{m.label}</s-button>
              ))}
            </s-stack>
            <s-text tone="neutral">{cart.customerId ? "Customer attached" : "No customer attached"} · {cart.items.length} cart item{cart.items.length === 1 ? "" : "s"}</s-text>
          </s-section>

          <s-section heading="Conversation">
            <s-stack direction="block" gap="small">
              {messages.map((msg, index) => (
                <s-box key={index} padding="small">
                  <s-text type="strong" tone={msg.role === "user" ? "info" : "base"}>{msg.role === "user" ? "You" : "ESR AI"}</s-text>
                  <s-text>{msg.content}</s-text>
                  {msg.role === "assistant" && msg.productRecommendations && msg.productRecommendations.length > 0 && (
                    <ProductCards products={msg.productRecommendations} />
                  )}
                </s-box>
              ))}
              {loading && <s-spinner accessibilityLabel="ESR AI thinking" />}
            </s-stack>
          </s-section>

          <s-section heading="Quick actions">
            <s-stack direction="inline" gap="small">
              {quick[mode].map((q) => <s-button key={q} variant="secondary" onClick={() => send(q)}>{q}</s-button>)}
            </s-stack>
          </s-section>

          <s-section heading="Ask">
            <s-stack direction="block" gap="small">
              <s-text-field label="Question" value={input} onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)} />
              <s-button variant="primary" onClick={() => send()} disabled={loading}>Ask ESR AI</s-button>
            </s-stack>
          </s-section>
          </s-stack>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
}

export default async () => render(<Modal />, document.body);
