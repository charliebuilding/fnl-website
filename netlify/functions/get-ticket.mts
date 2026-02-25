import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import Stripe from "stripe";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Missing session_id" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Verify session is paid via Stripe
  const stripe = new Stripe(stripeKey);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return new Response(JSON.stringify({ error: "Session not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  if (session.payment_status !== "paid") {
    return new Response(JSON.stringify({ error: "Payment not completed" }), { status: 402, headers: { "Content-Type": "application/json" } });
  }

  // Fetch all registration records for this session
  const store = getStore("fnl-registrations");
  const { blobs } = await store.list({ prefix: `${sessionId}-` });

  const tickets = await Promise.all(
    blobs.map(async b => await store.get(b.key, { type: "json" }))
  );

  const validTickets = tickets.filter(Boolean);

  if (validTickets.length === 0) {
    // May not be confirmed yet (webhook delay) — return basic info from session
    const { eventId, tierId, eventName, quantity } = session.metadata ?? {};
    return new Response(JSON.stringify({
      pending: true,
      sessionId,
      eventId,
      tierId,
      eventName,
      quantity,
      amountPaid: session.amount_total,
      currency: session.currency,
      customerEmail: session.customer_email,
    }), {
      status: 202,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ tickets: validTickets }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

export const config = {
  path: "/api/tickets/ticket"
};
