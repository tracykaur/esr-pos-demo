use serde::Deserialize;
use shopify_function::prelude::*;
use shopify_function::Result;

#[derive(Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    #[allow(dead_code)]
    percentage: f64,
    free_shipping_for_concierge: bool,
}

#[shopify_function_target(
    query_path = "src/cart_delivery_options_discounts_generate_run.graphql",
    schema_path = "schema.graphql"
)]
fn cart_delivery_options_discounts_generate_run(
    input: input::ResponseData,
) -> Result<output::CartDeliveryOptionsDiscountsGenerateRunResult> {
    let no_discount = output::CartDeliveryOptionsDiscountsGenerateRunResult { operations: vec![] };

    let has_shipping_class = input
        .discount
        .discount_classes
        .contains(&input::DiscountClass::SHIPPING);
    if !has_shipping_class {
        return Ok(no_discount);
    }

    let configuration = input
        .discount
        .metafield
        .as_ref()
        .and_then(|metafield| serde_json::from_value::<Configuration>(metafield.json_value.clone()).ok())
        .unwrap_or_default();

    if !configuration.free_shipping_for_concierge {
        return Ok(no_discount);
    }

    let is_concierge = input
        .cart
        .buyer_identity
        .as_ref()
        .and_then(|buyer_identity| buyer_identity.customer.as_ref())
        .map(|customer| customer.is_concierge)
        .unwrap_or(false);

    if !is_concierge || input.cart.delivery_groups.is_empty() {
        return Ok(no_discount);
    }

    let targets = input
        .cart
        .delivery_groups
        .iter()
        .map(|group| {
            output::DeliveryDiscountCandidateTarget::DeliveryGroup(
                output::DeliveryGroupTarget {
                    id: group.id.clone(),
                },
            )
        })
        .collect();

    Ok(output::CartDeliveryOptionsDiscountsGenerateRunResult {
        operations: vec![output::DeliveryOperation::DeliveryDiscountsAdd(
            output::DeliveryDiscountsAddOperation {
                selection_strategy: output::DeliveryDiscountSelectionStrategy::ALL,
                candidates: vec![output::DeliveryDiscountCandidate {
                    targets,
                    value: output::DeliveryDiscountCandidateValue::Percentage(output::Percentage {
                        value: Decimal(100.0),
                    }),
                    message: Some("Concierge - free delivery".to_string()),
                    associated_discount_code: None,
                }],
            },
        )],
    })
}
