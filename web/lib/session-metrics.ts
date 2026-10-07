// Pure module (no imports) so it can be unit-tested with plain `node --test`.

/** cacheRead / (input + cacheRead + cacheCreation); null when the session has no input-side tokens. */
export function cacheRatio(tokens: {
  tokensInput: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
}): number | null {
  const denominator = tokens.tokensInput + tokens.tokensCacheRead + tokens.tokensCacheCreation;
  return denominator > 0 ? tokens.tokensCacheRead / denominator : null;
}

/** Mean of the non-null values, or null when there are none — missing data is excluded, never counted as 0. */
export function meanOfKnown(values: (number | null | undefined)[]): { mean: number | null; n: number } {
  const known = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (known.length === 0) return { mean: null, n: 0 };
  return { mean: known.reduce((a, b) => a + b, 0) / known.length, n: known.length };
}
