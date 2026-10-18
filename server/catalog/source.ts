import type { Provenance, RequirementCategory } from '../../shared/types.js';

/** A product listing as returned by a catalog source, before RELIEFOS evaluates it. */
export interface RawListing {
  provenance: Provenance;
  sourceProductId: string;
  title: string;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  buyUrl: string | null;
  merchantDomain: string | null;
  /** Listed price in major units (dollars); null when the source returned no usable offer. */
  price: number | null;
  currency: string;
  availability: string | null;
  /** A bounded subset of the provider payload kept for provenance. */
  raw: Record<string, unknown>;
}

export interface CatalogSearch {
  query: string;
  limit: number;
  maxPrice?: number;
  /** Used only by the offline fixture catalog to pick its listings; live sources search by query. */
  category: RequirementCategory;
}

export interface ProductSource {
  readonly provenance: Provenance;
  search(input: CatalogSearch): Promise<RawListing[]>;
}

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}
