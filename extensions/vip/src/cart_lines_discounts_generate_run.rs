use serde::Deserialize;
use shopify_function::prelude::*;
use shopify_function::Result;

#[derive(Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    percentage: f64,
    #[allow(dead_code)]
    free_shipping_for_concierge: bool,
}

const GIFT_ATTR_VALUE: &str = "true";
const GIFT_MESSAGE: &str = "VIP free gift";

#[shopify_function_target(
    query_path = "src/cart_lines_discounts_generate_run.graphql",
    schema_path = "schema.graphql"
)]
fn cart_lines_discounts_generate_run(
    input: input::ResponseData,
) -> Result<output::CartLinesDiscountsGenerateRunResult> {
    let no_discount = output::CartLinesDiscountsGenerateRunResult { operations: vec![] };

    let has_product_class = input
        .discount
        .discount_classes
        .contains(&input::DiscountClass::PRODUCT);
    if !has_product_class {
        return Ok(no_discount);
    }

    let configuration = input
        .discount
        .metafield
        .as_ref()
        .and_then(|metafield| serde_json::from_value::<Configuration>(metafield.json_value.clone()).ok())
        .unwrap_or_default();

    let has_vip_discount_entitlement = input
        .cart
        .buyer_identity
        .as_ref()
        .and_then(|buyer_identity| buyer_identity.customer.as_ref())
        .map(|customer| customer.is_vip || customer.is_concierge)
        .unwrap_or(false);

    let mut gift_targets: Vec<output::ProductDiscountCandidateTarget> = Vec::new();
    let mut vip_targets: Vec<output::ProductDiscountCandidateTarget> = Vec::new();

    for line in input.cart.lines.iter() {
        let is_gift = line
            .gift_attribute
            .as_ref()
            .and_then(|attr| attr.value.as_deref())
            .map(|value| value == GIFT_ATTR_VALUE)
            .unwrap_or(false);

        if is_gift {
            gift_targets.push(output::ProductDiscountCandidateTarget::CartLine(
                output::CartLineTarget {
                    id: line.id.clone(),
                    quantity: None,
                },
            ));
        } else if has_vip_discount_entitlement && configuration.percentage > 0.0 {
            vip_targets.push(output::ProductDiscountCandidateTarget::CartLine(
                output::CartLineTarget {
                    id: line.id.clone(),
                    quantity: None,
                },
            ));
        }
    }

    let mut candidates: Vec<output::ProductDiscountCandidate> = Vec::new();

    if !gift_targets.is_empty() {
        candidates.push(output::ProductDiscountCandidate {
            targets: gift_targets,
            value: output::ProductDiscountCandidateValue::Percentage(output::Percentage {
                value: Decimal(100.0),
            }),
            message: Some(GIFT_MESSAGE.to_string()),
            associated_discount_code: None,
            prerequisites: None,
        });
    }

    if !vip_targets.is_empty() {
        candidates.push(output::ProductDiscountCandidate {
            targets: vip_targets,
            value: output::ProductDiscountCandidateValue::Percentage(output::Percentage {
                value: Decimal(configuration.percentage),
            }),
            message: Some(format!("VIP {}% off", configuration.percentage as i64)),
            associated_discount_code: None,
            prerequisites: None,
        });
    }

    if candidates.is_empty() {
        return Ok(no_discount);
    }

    Ok(output::CartLinesDiscountsGenerateRunResult {
        operations: vec![output::CartOperation::ProductDiscountsAdd(
            output::ProductDiscountsAddOperation {
                selection_strategy: output::ProductDiscountSelectionStrategy::FIRST,
                candidates,
            },
        )],
    })
}
