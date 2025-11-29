import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type VolumeDiscountConfig = {
  products: string[];
  minQty: number;
  percentOff: number;
};

type SelectedProduct = {
  id: string;
  title: string | null;
};

type LoaderData = {
  shopId: string;
  config: VolumeDiscountConfig;
  productSummaries: SelectedProduct[];
};

const MIN_QTY = 2;
const DEFAULT_CONFIG: VolumeDiscountConfig = {
  products: [],
  minQty: MIN_QTY,
  percentOff: 0,
};

const cardStyle: CSSProperties = {
  border: "1px solid var(--p-color-border-secondary, #dfe3e8)",
  borderRadius: "var(--p-border-radius-300, 12px)",
  padding: "1rem",
  background: "var(--p-color-bg-surface, #fff)",
};

const mutedTextStyle: CSSProperties = {
  color: "var(--p-color-text-subdued, #6d7175)",
  margin: 0,
};

const inputStyle: CSSProperties = {
  width: "160px",
  padding: "0.5rem",
  borderRadius: "var(--p-border-radius-200, 8px)",
  border: "1px solid var(--p-color-border-secondary, #dfe3e8)",
};

const listStyle: CSSProperties = {
  margin: "0.75rem 0 0",
  paddingLeft: "1.25rem",
};

const parseConfig = (value?: string | null): VolumeDiscountConfig => {
  if (!value) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(value);
    return {
      products: Array.isArray(parsed?.products) ? parsed.products : [],
      minQty:
        typeof parsed?.minQty === "number" && parsed.minQty > 0
          ? parsed.minQty
          : MIN_QTY,
      percentOff:
        typeof parsed?.percentOff === "number" && parsed.percentOff >= 0
          ? parsed.percentOff
          : 0,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query VolumeDiscountConfig {
        shop {
          id
          metafield(namespace: "volume_discount", key: "config") {
            value
          }
        }
      }
    `,
  );

  const jsonResponse = await response.json();
  const shop = jsonResponse.data?.shop;
  const config = parseConfig(shop?.metafield?.value);
  config.minQty = MIN_QTY;

  const productSummaries = await fetchProductSummaries(
    admin,
    config.products ?? [],
  );

  return {
    shopId: shop?.id ?? "",
    config,
    productSummaries,
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const shopId = formData.get("shopId");
  const percentOffRaw = formData.get("percentOff");
  const productsRaw = formData.get("products");

  if (typeof shopId !== "string" || shopId.length === 0) {
    return { ok: false as const, error: "Missing shop identifier." };
  }

  let products: string[] = [];
  if (typeof productsRaw === "string" && productsRaw.length) {
    try {
      const parsed = JSON.parse(productsRaw);
      if (Array.isArray(parsed)) {
        products = parsed.filter((id): id is string => typeof id === "string");
      }
    } catch {
      return { ok: false as const, error: "Unable to read selected products." };
    }
  }

  if (!products.length) {
    return { ok: false as const, error: "Select at least one product." };
  }

  const percentOff = Number(percentOffRaw);
  if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) {
    return {
      ok: false as const,
      error: "Enter a percent between 0 and 100.",
    };
  }

  const payload: VolumeDiscountConfig = {
    products,
    minQty: MIN_QTY,
    percentOff: Number(percentOff.toFixed(2)),
  };

  const mutationResponse = await admin.graphql(
    `#graphql
      mutation SaveVolumeDiscount($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            namespace: "volume_discount",
            key: "config",
            type: "json",
            value: JSON.stringify(payload),
            ownerId: shopId,
          },
        ],
      },
    },
  );

  const mutationJson = await mutationResponse.json();
  const userErrors = mutationJson.data?.metafieldsSet?.userErrors ?? [];

  if (userErrors.length) {
    return {
      ok: false as const,
      error: userErrors[0]?.message ?? "Save failed.",
    };
  }

  return { ok: true as const, config: payload };
};

export default function Index() {
  const { shopId, config, productSummaries } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [selectedProducts, setSelectedProducts] =
    useState<SelectedProduct[]>(productSummaries);
  const [percentOff, setPercentOff] = useState(
    config.percentOff ? String(config.percentOff) : "",
  );

  const productsPayload = useMemo(
    () => JSON.stringify(selectedProducts.map((product) => product.id)),
    [selectedProducts],
  );

  const error = fetcher.data?.ok === false ? fetcher.data.error : null;
  const isSubmitting =
    fetcher.state === "submitting" || fetcher.state === "loading";

  const openProductPicker = async () => {
    const selectionIds = selectedProducts.map((product) => ({ id: product.id }));

    const result = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: true,
      selectionIds,
    });

    if (!result?.selection) {
      return;
    }

    const chosen = result.selection.map((product) => ({
      id: product.id,
      title: product.title ?? null,
    }));

    setSelectedProducts(chosen);
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.toast.show("Volume discount saved");
    }
  }, [fetcher.data?.ok, fetcher.state, shopify]);

  return (
    <s-page heading="Volume discount">
      <s-section heading="Configure your offer">
        <fetcher.Form method="POST">
          <input type="hidden" name="shopId" value={shopId} />
          <input type="hidden" name="products" value={productsPayload} />
          <input type="hidden" name="minQty" value={config.minQty} />

          <s-stack direction="block" gap="base">
            {error && (
              <s-banner tone="critical">
                <p style={{ margin: 0 }}>{error}</p>
              </s-banner>
            )}

            <div style={cardStyle}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h3 style={{ margin: 0 }}>Eligible products</h3>
                <p style={mutedTextStyle}>
                  Choose the products that will receive the discount when at least {config.minQty} are in the cart.
                </p>
                <s-button type="button" onClick={openProductPicker}>
                  {selectedProducts.length ? "Edit selection" : "Select products"}
                </s-button>
                {selectedProducts.length ? (
                  <ul style={listStyle}>
                    {selectedProducts.map((product) => (
                      <li key={product.id}>
                        {product.title ?? product.id.split("/").pop()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={mutedTextStyle}>No products selected yet.</p>
                )}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <label htmlFor="minQty" style={{ fontWeight: 600 }}>
                  Minimum quantity
                </label>
                <input
                  id="minQty"
                  name="minQtyDisplay"
                  type="number"
                  value={config.minQty}
                  readOnly
                  style={{ ...inputStyle, width: "120px" }}
                />
                <p style={mutedTextStyle}>
                  The minimum quantity is fixed at {config.minQty}.
                </p>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <label htmlFor="percentOff" style={{ fontWeight: 600 }}>
                  Percent off
                </label>
                <input
                  id="percentOff"
                  name="percentOff"
                  type="number"
                  min="1"
                  max="100"
                  step="0.5"
                  required
                  value={percentOff}
                  onChange={(event) => setPercentOff(event.currentTarget.value)}
                  placeholder="Enter a value (e.g. 10)"
                  style={inputStyle}
                />
                <p style={mutedTextStyle}>
                  This percentage will be applied to every selected product when the minimum quantity is met.
                </p>
              </div>
            </div>

            <s-button variant="primary" type="submit" loading={isSubmitting}>
              Save configuration
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

const fetchProductSummaries = async (
  admin: any,
  ids: string[],
): Promise<SelectedProduct[]> => {
  if (!ids.length) {
    return [];
  }

  const response = await admin.graphql(
    `#graphql
      query VolumeDiscountProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
          }
        }
      }
    `,
    { variables: { ids } },
  );

  const jsonResponse = await response.json();
  const nodes = jsonResponse.data?.nodes ?? [];
  const summaries = nodes
    .filter((node: any) => node?.id)
    .map((node: any) => ({
      id: node.id as string,
      title: (node.title as string) ?? null,
    }));

  return ids
    .map((id) => summaries.find((summary: SelectedProduct) => summary.id === id))
    .filter((summary): summary is SelectedProduct => Boolean(summary));
};
