import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

/**
 * Manager Discount Modal — ESR Group (Early Settler)
 * 1. Manager authenticates via PinPad
 * 2. Selects discount type (%, $) and amount
 * 3. Discount applied to cart with audit trail via cart properties
 *
 * Preset amounts are sized for furniture/homewares high-AOV orders.
 * Target: pos.home.modal.render
 */

// Demo manager PINs — replace with real values for production
const MANAGER_PINS = {
  "1234": "Store Manager",
  "5678": "Assistant Manager",
  "9999": "Area Manager",
};

// Furniture-appropriate preset discounts (high-AOV)
const PRESET_DISCOUNTS = [
  { label: "5%",     type: "Percentage", amount: "5"   },
  { label: "10%",    type: "Percentage", amount: "10"  },
  { label: "15%",    type: "Percentage", amount: "15"  },
  { label: "$50 off",  type: "FixedAmount", amount: "50"  },
  { label: "$100 off", type: "FixedAmount", amount: "100" },
  { label: "$250 off", type: "FixedAmount", amount: "250" },
];

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [step, setStep] = useState("auth"); // auth | select | confirm | done
  const [managerName, setManagerName] = useState("");
  const [selectedDiscount, setSelectedDiscount] = useState(null);
  const [customAmount, setCustomAmount] = useState("");
  const [customType, setCustomType] = useState("Percentage");
  const [cartTotal, setCartTotal] = useState("0.00");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = shopify.cart.current.subscribe((cart) => {
      setCartTotal(cart?.subtotal ?? "0.00");
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (step === "auth") showPinPad();
  }, []);

  const showPinPad = useCallback(() => {
    shopify.pinPad.showPinPad(
      (pin) => {
        const manager = MANAGER_PINS[pin.join("")];
        if (manager) {
          setManagerName(manager);
          setStep("select");
          return { result: "accept" };
        }
        return { result: "reject", errorMessage: "Invalid manager PIN. Try again." };
      },
      {
        title: "Manager Authorization",
        label: "Enter your manager PIN",
        masked: true,
        minPinLength: 4,
        maxPinLength: 6,
      },
    );
  }, []);

  const applyDiscount = useCallback(
    async (type, amount, label) => {
      try {
        await shopify.cart.applyCartDiscount(type, label, amount);
        await shopify.cart.addCartProperties({
          manager_approved_discount: "true",
          manager_name: managerName,
          discount_type: type,
          discount_amount: amount,
          discount_approved_at: new Date().toISOString(),
        });
        setStep("done");
        shopify.toast.show(`${label} applied by ${managerName}`);
      } catch (err) {
        setError(`Failed to apply discount: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [managerName],
  );

  if (step === "auth") {
    return (
      <s-page heading="Manager Discount">
        <s-scroll-box>
          <s-section>
            <s-text>Waiting for manager PIN...</s-text>
          </s-section>
          <s-section>
            <s-button variant="secondary" onClick={showPinPad}>Show PIN Pad</s-button>
          </s-section>
        </s-scroll-box>
      </s-page>
    );
  }

  if (step === "select") {
    return (
      <s-page heading="Manager Discount">
        <s-scroll-box>
          <s-section>
            <s-stack direction="block" gap="small">
              <s-text type="strong">Authorized: {managerName}</s-text>
              <s-text color="subdued">Cart total: ${cartTotal}</s-text>
            </s-stack>
          </s-section>

          <s-section heading="Quick Discounts">
            <s-stack direction="inline" gap="small">
              {PRESET_DISCOUNTS.map((d) => (
                <s-button
                  key={d.label}
                  variant="secondary"
                  onClick={() => { setSelectedDiscount(d); setStep("confirm"); }}
                >
                  {d.label}
                </s-button>
              ))}
            </s-stack>
          </s-section>

          <s-divider />

          <s-section heading="Custom Discount">
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small">
                <s-button
                  variant={customType === "Percentage" ? "primary" : "secondary"}
                  onClick={() => setCustomType("Percentage")}
                >%</s-button>
                <s-button
                  variant={customType === "FixedAmount" ? "primary" : "secondary"}
                  onClick={() => setCustomType("FixedAmount")}
                >$</s-button>
              </s-stack>
              <s-number-field
                value={customAmount}
                placeholder={customType === "Percentage" ? "e.g. 12" : "e.g. 300.00"}
                label="Discount amount"
                onInput={(e) => setCustomAmount(e.target.value)}
              />
              <s-button
                variant="primary"
                disabled={!customAmount}
                onClick={() => {
                  setSelectedDiscount({
                    label: `Custom ${customType === "Percentage" ? customAmount + "%" : "$" + customAmount}`,
                    type: customType,
                    amount: customAmount,
                  });
                  setStep("confirm");
                }}
              >
                Apply Custom Discount
              </s-button>
            </s-stack>
          </s-section>

          {error && <s-banner tone="critical">{error}</s-banner>}
        </s-scroll-box>
      </s-page>
    );
  }

  if (step === "confirm" && selectedDiscount) {
    return (
      <s-page heading="Confirm Discount">
        <s-scroll-box>
          <s-section>
            <s-stack direction="block" gap="small">
              <s-text type="strong">Discount: {selectedDiscount.label}</s-text>
              <s-text>Authorized by: {managerName}</s-text>
              <s-text color="subdued">Cart total: ${cartTotal}</s-text>
            </s-stack>
          </s-section>
          <s-section>
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={() => applyDiscount(selectedDiscount.type, selectedDiscount.amount, `Manager: ${selectedDiscount.label}`)}
              >
                Confirm &amp; Apply
              </s-button>
              <s-button variant="secondary" onClick={() => { setSelectedDiscount(null); setStep("select"); }}>
                Back
              </s-button>
            </s-stack>
          </s-section>
          {error && <s-banner tone="critical">{error}</s-banner>}
        </s-scroll-box>
      </s-page>
    );
  }

  return (
    <s-page heading="Discount Applied">
      <s-scroll-box>
        <s-section>
          <s-stack direction="block" gap="small">
            <s-badge tone="success">Applied</s-badge>
            <s-text type="strong">{selectedDiscount?.label}</s-text>
            <s-text>Authorized by: {managerName}</s-text>
            <s-text color="subdued">Audit trail saved to order properties</s-text>
          </s-stack>
        </s-section>
      </s-scroll-box>
    </s-page>
  );
}
