// src/lib/schemas.ts
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* PRODUCT SCHEMA                                                             */
/* -------------------------------------------------------------------------- */

export const productSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().min(1, "Title is required"),

    // NEW: Crucial for SEO-friendly Next.js routing (e.g., /product/freelance-contract)
    slug: z.string().min(1, "Slug is required"),

    description: z.string().min(1, "Description is required"),

    // Store all prices in cents! $1.00 = 100. $3.50 = 350.
    price: z.number().min(100, "Price must be at least 100 cents").default(100),

    // NEW: Frontend Categorization & UI Data
    category: z.enum(["contracts", "finance", "proposals", "client-management", "productivity", "bundles"]),
    // NEW: Buyers must know what software they need before spending their dollar
    fileType: z.enum(["DOCX", "XLSX", "Figma", "Notion", "Google Sheets", "PDF", "ZIP"]),

    // Digital Delivery
    deliverableUrl: z.string().url("Must be a valid Canva, Google Drive, or Notion URL"),
    // CHANGED: Made an array. The SaaS aesthetic requires multiple images (Thumbnail, Preview 1, Preview 2)
    images: z.array(z.string().url("Must be a valid image URL")).default([]),

    // Bundle Logic
    isBundle: z.boolean().default(false),
    includedProductIds: z.array(z.string()).default([]),

    // Store settings
    active: z.boolean().default(true),

    // NEW: Enables the "Trending" section on your homepage by sorting Firebase queries
    salesCount: z.number().default(0),

    // Timestamps
    createdAt: z.number(),
    updatedAt: z.number()
  })
  .superRefine((data, ctx) => {
    if (data.isBundle && data.category !== "bundles") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "Bundle products must use the 'bundles' category."
      });
    }

    if (!data.isBundle && data.category === "bundles") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "Only bundle products can use the 'bundles' category."
      });
    }
  });

export type Product = z.infer<typeof productSchema>;

/* -------------------------------------------------------------------------- */
/* ORDER SCHEMA                                                               */
/* -------------------------------------------------------------------------- */

export const orderItemSchema = z.object({
  productId: z.string(),
  title: z.string(),
  price: z.number(),
  deliverableUrl: z.string()
});

export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  checkoutMode: z.enum(["authenticated", "guest"]).optional(),
  accountEmail: z.string().email().optional(),
  checkoutEmail: z.string().email().optional(),
  deliveryEmail: z.string().email().optional(),
  customerEmail: z.string().email().optional(),

  // Stripe references
  stripeSessionId: z.string(),
  stripePaymentIntentId: z.string().optional(),
  stripePaymentStatus: z.enum(["unpaid", "paid", "no_payment_required"]).optional(),
  checkoutAttemptId: z.string().optional(),
  checkoutProductId: z.string().optional(),
  stripeCheckoutIdempotencyKey: z.string().optional(),
  stripeCheckoutFirstAttemptAt: z.number().optional(),
  checkoutStatus: z
    .enum([
      "creating_session",
      "session_creation_indeterminate",
      "session_creation_manual_review",
      "session_created",
      "payment_failed",
      "session_expired",
      "product_unavailable",
      "session_creation_failed"
    ])
    .optional(),
  checkoutFailureReason: z.string().optional(),
  stripeCheckoutSnapshot: z
    .object({
      customerEmail: z.string().email().optional(),
      currency: z.string(),
      productName: z.string(),
      productDescription: z.string(),
      productImage: z.string(),
      unitAmount: z.number().int().nonnegative(),
      successUrl: z.string().url(),
      cancelUrl: z.string().url()
    })
    .optional(),
  lastProcessedStripeEventId: z.string().optional(),
  lastProcessedStripeEventType: z.string().optional(),
  amountTotal: z.number(),

  items: z.array(orderItemSchema),

  // Fulfillment tracking
  status: z.enum(["pending", "paid", "failed"]),
  deliveryEmailSent: z.boolean().default(false),
  deliveryEmailStatus: z.enum(["pending", "sending", "sent", "failed", "manual_review"]).optional(),
  deliveryEmailAttempts: z.number().int().nonnegative().optional(),
  deliveryEmailClaimId: z.string().optional(),
  deliveryEmailClaimedAt: z.number().optional(),
  deliveryEmailFirstAttemptAt: z.number().optional(),
  deliveryEmailNextAttemptAt: z.number().optional(),
  deliveryEmailIdempotencyKey: z.string().optional(),
  deliveryEmailSentAt: z.number().optional(),
  deliveryEmailProviderId: z.string().optional(),
  deliveryEmailError: z.string().optional(),
  deliveryEmailManualReviewReason: z.string().optional(),

  createdAt: z.number(),
  updatedAt: z.number().optional()
});

export type Order = z.infer<typeof orderSchema>;
