import { ProductDiscountSelectionStrategy } from "../generated/api";

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */

export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length) {
    throw new Error("No cart lines found");
  }

  const hasMetafield = input.shop.metafield?.value ?? null;

  if (hasMetafield) {
    const {
      products: productIds,
      percentOff,
      minQty,
    } = JSON.parse(input.shop.metafield.value);
    
    let totalQty = 0;
    for (const line of input.cart.lines) {
      if (
        line.merchandise.__typename === "ProductVariant" &&
        productIds.includes(line.merchandise.product.id)
      ) {
        totalQty += line.quantity;
      }
    }

    if (totalQty < minQty) {
      return { operations: [] };
    }
    const candidates = input.cart.lines
      .filter(
        (line) =>
          line.merchandise.__typename === "ProductVariant" &&
          productIds.includes(line.merchandise.product.id),
      )
      .map((line) => ({
        message: `Buy 2, ${percentOff}% off.`,
        targets: [
          {
            cartLine: {
              id: line.id,
              quantity: line.quantity,
            },
          },
        ],
        value: {
          percentage: {
            value: percentOff,
          },
        },
      }));

    if (!candidates.length) {
      return { operations: [] };
    }

    return {
      operations: [
        {
          productDiscountsAdd: {
            candidates,
            selectionStrategy: ProductDiscountSelectionStrategy.All,
          },
        },
      ],
    };
  } else {
    return { operations: [] };
  }
}
