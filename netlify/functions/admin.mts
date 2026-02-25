import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { EVENTS } from "./events-config.js";

export default async (req: Request, context: Context) => {
  const adminToken = Netlify.env.get("ADMIN_TOKEN");
  const authHeader = req.headers.get("x-admin-token");

  if (!adminToken || authHeader !== adminToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "registrations";

  if (action === "registrations") {
    // Fetch all registrations
    const store = getStore("fnl-registrations");
    const { blobs } = await store.list();

    const registrations = await Promise.all(
      blobs.map(async b => {
        try {
          return await store.get(b.key, { type: "json" });
        } catch {
          return null;
        }
      })
    );

    const valid = registrations.filter(Boolean);

    // Group by event
    const byEvent: Record<string, any[]> = {};
    for (const reg of valid) {
      if (!byEvent[reg.eventId]) byEvent[reg.eventId] = [];
      byEvent[reg.eventId].push(reg);
    }

    return new Response(JSON.stringify({
      total: valid.length,
      byEvent,
      registrations: valid.sort((a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (action === "capacity") {
    const capacityStore = getStore("fnl-capacity");
    const result: Record<string, any> = {};

    for (const event of Object.values(EVENTS)) {
      result[event.id] = { name: event.name, tiers: {} };
      for (const tier of event.tiers) {
        const soldKey = `${event.id}:${tier.id}:sold`;
        const sold = (await capacityStore.get(soldKey, { type: "json" }) as number | null) ?? 0;
        result[event.id].tiers[tier.id] = {
          name: tier.name,
          totalCapacity: tier.totalCapacity,
          sold,
          available: tier.totalCapacity - sold,
          revenue: sold * tier.price,
        };
      }
    }

    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (action === "waitlist") {
    const store = getStore("fnl-waitlist");
    const { blobs } = await store.list();
    const entries = await Promise.all(blobs.map(async b => await store.get(b.key, { type: "json" })));
    return new Response(JSON.stringify({ total: entries.length, entries: entries.filter(Boolean) }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (action === "export-csv") {
    const store = getStore("fnl-registrations");
    const { blobs } = await store.list();
    const registrations = await Promise.all(blobs.map(async b => await store.get(b.key, { type: "json" })));
    const valid = registrations.filter(Boolean);

    const headers = ["Registration ID", "Session ID", "Event", "Tier", "First Name", "Last Name", "Email", "T-Shirt Size", "Emergency Contact", "Emergency Phone", "Amount Paid (£)", "Confirmed At"];
    const rows = valid.map((r: any) => [
      r.registrationId,
      r.sessionId,
      r.eventName,
      r.tierId,
      r.runner?.firstName ?? "",
      r.runner?.lastName ?? "",
      r.runner?.email ?? r.customerEmail ?? "",
      r.runner?.tshirtSize ?? "",
      r.runner?.emergencyName ?? "",
      r.runner?.emergencyPhone ?? "",
      r.amountPaid ? (r.amountPaid / 100).toFixed(2) : "",
      r.confirmedAt,
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="fnl-registrations-${new Date().toISOString().slice(0,10)}.csv"`
      }
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { "Content-Type": "application/json" } });
};

export const config = {
  path: "/api/tickets/admin"
};
