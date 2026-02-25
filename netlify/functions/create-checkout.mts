import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import Stripe from "stripe";
import { getEvent, getTier, MAX_GROUP_SIZE, GROUP_DISCOUNT_THRESHOLD, GROUP_DISCOUNT_PERCENT } from "./events-config.js";

interface Runner {
  firstName: string;
  lastName: string;
  email: string;
  emergencyName: string;
  emergencyPhone: string;
  tshirtSize: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
  dateOfBirth?: string;
}

interface CheckoutRequest {
  eventId: string;
  tierId: string;
  runners: Runner[];
  promoCode?: string;
  leadEmail: string;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "Stripe not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let body: CheckoutRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { eventId, tierId, runners, promoCode, leadEmail } = body;

  // Validate event and tier
  const event = getEvent(eventId);
  const tier = getTier(eventId, tierId);
  if (!event || !tier) {
    return new Response(JSON.stringify({ error: "Invalid event or ticket tier" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Validate runners
  if (!runners || runners.length < 1 || runners.length > MAX_GROUP_SIZE) {
    return new Response(JSON.stringify({ error: `Please provide between 1 and ${MAX_GROUP_SIZE} runners` }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  for (const r of runners) {
    if (!r.firstName || !r.lastName || !r.email || !r.emergencyName || !r.emergencyPhone || !r.tshirtSize) {
      return new Response(JSON.stringify({ error: "All runner fields are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }

  // Check capacity
  const store = getStore({ name: "fnl-capacity", consistency: "strong" });
  const soldKey = `${eventId}:${tierId}:sold`;
  const sold = (await store.get(soldKey, { type: "json" }) as number | null) ?? 0;
  const available = tier.totalCapacity - sold;

  if (available < runners.length) {
    if (available <= 0) {
      return new Response(JSON.stringify({ error: "SOLD_OUT", message: "This ticket tier is sold out" }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "INSUFFICIENT_CAPACITY", message: `Only ${available} tickets remaining` }), { status: 409, headers: { "Content-Type": "application/json" } });
  }

  const stripe = new Stripe(stripeKey);
  const quantity = runners.length;

  // Calculate unit price with group discount
  let unitAmount = tier.price;
  let discountApplied = false;
  if (quantity >= GROUP_DISCOUNT_THRESHOLD) {
    unitAmount = Math.round(tier.price * (1 - GROUP_DISCOUNT_PERCENT / 100));
    discountApplied = true;
  }

  // Store runner data in blobs temporarily (linked by UUID, referenced in Stripe metadata)
  const runnersKey = crypto.randomUUID();
  const pendingStore = getStore("fnl-pending-registrations");
  await pendingStore.setJSON(runnersKey, {
    runners,
    eventId,
    tierId,
    quantity,
    createdAt: new Date().toISOString(),
  });

  // Build line items
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity,
      price_data: {
        currency: "gbp",
        unit_amount: unitAmount,
        product_data: {
          name: `${event.name} — ${tier.name}`,
          description: tier.description,
          metadata: {
            eventId,
            tierId,
            eventDate: event.date,
            eventLocation: event.location,
          }
        },
      }
    }
  ];

  if (discountApplied) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: 0, // No-charge informational line
        product_data: {
          name: `Group discount applied (${GROUP_DISCOUNT_PERCENT}% for ${GROUP_DISCOUNT_THRESHOLD}+ runners)`,
        }
      }
    });
  }

  // Build success URL with session ID
  const siteUrl = Netlify.env.get("URL") ?? "https://fnl-website.netlify.app";
  const successUrl = `${siteUrl}/tickets/success.html?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${siteUrl}/tickets/`;

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: lineItems,
    customer_email: leadEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      runnersKey,
      eventId,
      tierId,
      eventName: event.name,
      quantity: String(quantity),
    },
    invoice_creation: {
      enabled: true,
    },
  };

  // Apply promo code if provided
  if (promoCode) {
    try {
      const coupons = await stripe.coupons.list({ limit: 100 });
      const coupon = coupons.data.find(
        c => c.name?.toUpperCase() === promoCode.toUpperCase() && c.valid
      );
      if (coupon) {
        sessionParams.discounts = [{ coupon: coupon.id }];
      } else {
        // Try promotion codes
        const promoCodes = await stripe.promotionCodes.list({ active: true, limit: 100 });
        const promoCodeObj = promoCodes.data.find(
          p => p.code.toUpperCase() === promoCode.toUpperCase()
        );
        if (promoCodeObj) {
          sessionParams.discounts = [{ promotion_code: promoCodeObj.id }];
        } else {
          return new Response(JSON.stringify({ error: "INVALID_PROMO", message: "Promo code not found or expired" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
      }
    } catch {
      return new Response(JSON.stringify({ error: "Could not validate promo code" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  } else {
    sessionParams.allow_promotion_codes = true;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err: any) {
    console.error("Stripe error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export const config = {
  path: "/api/tickets/checkout"
};
