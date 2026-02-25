import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getEvent, getTier } from "./events-config.js";

interface WaitlistRequest {
  eventId: string;
  tierId: string;
  email: string;
  name: string;
  quantity?: number;
}

export default async (req: Request, context: Context) => {
  if (req.method === "GET") {
    // Admin: list all waitlist entries (protected)
    const adminToken = Netlify.env.get("ADMIN_TOKEN");
    const authHeader = req.headers.get("x-admin-token");
    if (!adminToken || authHeader !== adminToken) {
      return new Response("Unauthorized", { status: 401 });
    }

    const store = getStore("fnl-waitlist");
    const { blobs } = await store.list();
    const entries = await Promise.all(
      blobs.map(async b => {
        const data = await store.get(b.key, { type: "json" });
        return data;
      })
    );

    return new Response(JSON.stringify(entries.filter(Boolean)), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: WaitlistRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { eventId, tierId, email, name, quantity = 1 } = body;

  if (!eventId || !tierId || !email || !name) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const event = getEvent(eventId);
  const tier = getTier(eventId, tierId);
  if (!event || !tier) {
    return new Response(JSON.stringify({ error: "Invalid event or tier" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const store = getStore("fnl-waitlist");
  const key = `${eventId}:${tierId}:${Date.now()}:${crypto.randomUUID()}`;

  await store.setJSON(key, {
    key,
    eventId,
    tierId,
    eventName: event.name,
    tierName: tier.name,
    email,
    name,
    quantity,
    addedAt: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ success: true, message: "You're on the waitlist! We'll email you if a spot opens up." }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

export const config = {
  path: "/api/tickets/waitlist"
};
