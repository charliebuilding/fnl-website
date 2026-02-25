import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { EVENTS } from "./events-config.js";

export default async (req: Request, context: Context) => {
  const store = getStore("fnl-capacity");
  const stats: Record<string, any> = {};

  for (const event of Object.values(EVENTS)) {
    stats[event.id] = {
      id: event.id,
      name: event.name,
      date: event.date,
      dateIso: event.dateIso,
      totalCapacity: event.totalCapacity,
      tiers: {}
    };

    for (const tier of event.tiers) {
      const soldKey = `${event.id}:${tier.id}:sold`;
      const sold = (await store.get(soldKey, { type: "json" }) as number | null) ?? 0;
      const available = Math.max(0, tier.totalCapacity - sold);
      const percentSold = Math.round((sold / tier.totalCapacity) * 100);

      stats[event.id].tiers[tier.id] = {
        id: tier.id,
        name: tier.name,
        price: tier.price,
        description: tier.description,
        color: tier.color,
        totalCapacity: tier.totalCapacity,
        sold,
        available,
        percentSold,
        soldOut: available === 0,
        lowStock: available > 0 && available <= Math.ceil(tier.totalCapacity * 0.1), // <10% left
      };
    }
  }

  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30" // Cache 30 seconds
    }
  });
};

export const config = {
  path: "/api/tickets/stats"
};
