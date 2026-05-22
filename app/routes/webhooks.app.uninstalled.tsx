import type { ActionFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";

// Standard Remix-template cleanup of session row on uninstall (architect §5.4).
// We also clear our small per-shop lookup caches so a re-install starts fresh.

export async function action({ request }: ActionFunctionArgs) {
  const { shop, session } = await authenticate.webhook(request);

  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }
  await Promise.all([
    prisma.staffMember.deleteMany({ where: { shop } }),
    prisma.location.deleteMany({ where: { shop } }),
    prisma.segmentCache.deleteMany({ where: { shop } }),
  ]);

  return new Response(null, { status: 200 });
}
