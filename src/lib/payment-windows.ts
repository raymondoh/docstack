const HOUR_MS = 60 * 60 * 1000;

// Stripe and Resend document 24-hour idempotency retention. Stop automatic
// retries one hour early so queueing and network latency cannot cross the limit.
export const PROVIDER_IDEMPOTENCY_MAX_MS = 24 * HOUR_MS;
export const PROVIDER_IDEMPOTENCY_SAFETY_MARGIN_MS = HOUR_MS;
export const STRIPE_SAFE_RETRY_WINDOW_MS = PROVIDER_IDEMPOTENCY_MAX_MS - PROVIDER_IDEMPOTENCY_SAFETY_MARGIN_MS;
export const RESEND_SAFE_RETRY_WINDOW_MS = PROVIDER_IDEMPOTENCY_MAX_MS - PROVIDER_IDEMPOTENCY_SAFETY_MARGIN_MS;
