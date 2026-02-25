import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import Stripe from "stripe";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeKey || !webhookSecret) {
    console.error("Missing Stripe environment variables");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const stripe = new Stripe(stripeKey);

  // Verify webhook signature
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response("Missing signature", { status: 400 });
  }

  let event: Stripe.Event;
  const rawBody = await req.text();

  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { runnersKey, eventId, tierId, eventName, quantity } = session.metadata ?? {};

    if (!runnersKey || !eventId || !tierId) {
      console.error("Missing metadata in session", session.id);
      return new Response("Missing metadata", { status: 400 });
    }

    const qty = parseInt(quantity ?? "1", 10);

    // Fetch pending runner data
    const pendingStore = getStore("fnl-pending-registrations");
    const pendingData = await pendingStore.get(runnersKey, { type: "json" });

    if (!pendingData) {
      console.error("No pending registration found for key:", runnersKey);
      return new Response("Registration not found", { status: 404 });
    }

    const { runners } = pendingData as { runners: any[] };

    // Update capacity (strong consistency)
    const capacityStore = getStore({ name: "fnl-capacity", consistency: "strong" });
    const soldKey = `${eventId}:${tierId}:sold`;
    const currentSold = (await capacityStore.get(soldKey, { type: "json" }) as number | null) ?? 0;
    await capacityStore.setJSON(soldKey, currentSold + qty);

    // Create confirmed registration records
    const registrationStore = getStore("fnl-registrations");
    const timestamp = new Date().toISOString();

    // One registration record per runner
    for (let i = 0; i < runners.length; i++) {
      const runner = runners[i];
      const registrationId = `${session.id}-${i}`;
      const ticketData = {
        registrationId,
        sessionId: session.id,
        eventId,
        tierId,
        eventName: eventName ?? eventId,
        runner,
        amountPaid: session.amount_total,
        currency: session.currency,
        customerEmail: session.customer_email ?? runner.email,
        confirmedAt: timestamp,
        paymentStatus: session.payment_status,
        runnerIndex: i,
        totalRunners: runners.length,
      };
      await registrationStore.setJSON(registrationId, ticketData);
    }

    // Clean up pending data
    await pendingStore.delete(runnersKey);

    console.log(`✅ Confirmed ${qty} registration(s) for ${eventId} — session ${session.id}`);
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { runnersKey } = session.metadata ?? {};
    if (runnersKey) {
      const pendingStore = getStore("fnl-pending-registrations");
      await pendingStore.delete(runnersKey);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

export const config = {
  path: "/api/tickets/webhook"
};
