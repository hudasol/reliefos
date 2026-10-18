import { Channel3, Channel3Error, Channel3TimeoutError, type Channel3Api } from '@channel3/sdk';
import { CatalogError, type CatalogSearch, type ProductSource, type RawListing } from './source.js';

// Channel3 product search (https://docs.trychannel3.com). Price, availability and the buy link live
// on each offer, so a product is normalised to its cheapest new, in-stock USD offer. Stock levels and
// delivery times are NOT provided by Channel3 and are never inferred from this data.

export class Channel3Source implements ProductSource {
  readonly provenance = 'channel3' as const;
  private readonly client: Channel3;

  constructor(apiKey: string, opts: { timeoutSeconds?: number; maxRetries?: number } = {}) {
    this.client = new Channel3({
      apiKey,
      timeoutInSeconds: opts.timeoutSeconds ?? 12,
      maxRetries: opts.maxRetries ?? 2,
    });
  }

  async search(input: CatalogSearch): Promise<RawListing[]> {
    try {
      const page = await this.client.products.search({
        query: input.query,
        limit: Math.min(input.limit, 30),
        filters: {
          availability: ['InStock'],
          conditions: ['new'],
          ...(input.maxPrice ? { price: { max_price: input.maxPrice } } : {}),
        },
        config: { country: 'US', currency: 'USD' },
      });
      return page.data.map(normalizeChannel3Product);
    } catch (err) {
      if (err instanceof Channel3TimeoutError)
        throw new CatalogError('Channel3 search timed out', true);
      if (err instanceof Channel3Error) {
        const status = err.statusCode;
        const retryable = status === undefined || status === 429 || status >= 500;
        const reason =
          status === 401 || status === 403
            ? 'Channel3 rejected the API key'
            : status === 402
              ? 'Channel3 credits exhausted'
              : status === 429
                ? 'Channel3 rate limit reached'
                : `Channel3 request failed (${status ?? 'network'})`;
        throw new CatalogError(reason, retryable, status);
      }
      throw new CatalogError(`Channel3 request failed: ${(err as Error).message}`, true);
    }
  }
}

export function normalizeChannel3Product(p: Channel3Api.Product): RawListing {
  const offers = (p.offers ?? []).filter(
    (o) =>
      o.price?.currency === 'USD' &&
      o.availability === 'InStock' &&
      (o.condition ?? 'new') === 'new',
  );
  const best = offers.reduce<Channel3Api.ProductOffer | null>(
    (acc, o) => (acc === null || o.price.price < acc.price.price ? o : acc),
    null,
  );
  const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    provenance: 'channel3',
    sourceProductId: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name ?? null,
    description: p.description ?? null,
    imageUrl: image?.cleaned_url ?? image?.url ?? null,
    buyUrl: best?.url ?? null,
    merchantDomain: best?.domain ?? null,
    price: best ? best.price.price : null,
    currency: best?.price.currency ?? 'USD',
    availability: best?.availability ?? null,
    raw: {
      id: p.id,
      category: p.category?.title ?? null,
      offerCount: p.offers?.length ?? 0,
      keyFeatures: (p.key_features ?? []).slice(0, 6),
      offers: (p.offers ?? []).slice(0, 5).map((o) => ({
        domain: o.domain,
        price: o.price?.price,
        currency: o.price?.currency,
        availability: o.availability,
        condition: o.condition ?? null,
      })),
    },
  };
}
