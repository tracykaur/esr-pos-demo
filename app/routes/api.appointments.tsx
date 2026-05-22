import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { METAFIELDS_SET_MUTATION } from "~/graphql/customer";
import { gql, runRouteOp, userErrorsOf } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { authenticatePos } from "~/lib/pos-auth.server";

const APPOINTMENTS_KEY = "appointments";
const DEFAULT_DURATION_MINUTES = 45;
const MAX_APPOINTMENTS = 80;

const CUSTOMER_SUMMARY_QUERY = /* GraphQL */ `
  query AppointmentCustomerSummary($id: ID!) {
    customer(id: $id) {
      id
      displayName
      defaultEmailAddress {
        emailAddress
      }
      defaultPhoneNumber {
        phoneNumber
      }
      tags
    }
  }
`;

const SHOP_APPOINTMENTS_QUERY = /* GraphQL */ `
  query ShopAppointments($namespace: String!, $key: String!) {
    shop {
      id
      appointmentMetafield: metafield(namespace: $namespace, key: $key) {
        value
      }
    }
  }
`;

type AppointmentStatus = "booked" | "completed" | "cancelled";

type Appointment = {
  id: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerTags: string[];
  date: string;
  time: string;
  startsAt: string;
  durationMinutes: number;
  appointmentType: string;
  staffId: string | null;
  storeId: string | null;
  notes: string;
  status: AppointmentStatus;
  createdAt: string;
};

type AppointmentInput = {
  customerId?: unknown;
  customerName?: unknown;
  date?: unknown;
  time?: unknown;
  durationMinutes?: unknown;
  appointmentType?: unknown;
  staffId?: unknown;
  storeId?: unknown;
  notes?: unknown;
};

function toCustomerGid(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  if (raw.startsWith("gid://shopify/Customer/")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Customer/${raw}`;
  return raw;
}

function cleanText(value: unknown, max = 200): string {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

function cleanDate(value: unknown): string {
  const date = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose an appointment date.");
  return date;
}

function cleanTime(value: unknown): string {
  const time = cleanText(value, 10);
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("Choose an appointment time.");
  return time;
}

function cleanDuration(value: unknown): number {
  const n = Number(value ?? DEFAULT_DURATION_MINUTES);
  if (!Number.isFinite(n) || n < 15 || n > 240) return DEFAULT_DURATION_MINUTES;
  return Math.round(n);
}

function startsAtFor(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function parseAppointments(value: string | null | undefined): Appointment[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Appointment => Boolean(item) && typeof item === "object" && "id" in item && "startsAt" in item);
  } catch {
    return [];
  }
}

function upcoming(appointments: Appointment[]): Appointment[] {
  const now = Date.now();
  return appointments
    .filter((appointment) => appointment.status === "booked" && new Date(appointment.startsAt).getTime() >= now - 60 * 60 * 1000)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

function dayCounts(appointments: Appointment[]) {
  const counts: Record<string, number> = {};
  for (const appointment of upcoming(appointments)) {
    counts[appointment.date] = (counts[appointment.date] ?? 0) + 1;
  }
  return counts;
}

async function getShopAppointments(admin: unknown) {
  const data = await gql<{
    shop: { id: string; appointmentMetafield: { value: string | null } | null };
  }>(admin, SHOP_APPOINTMENTS_QUERY, {
    namespace: ELKA.shopMetafieldNamespace,
    key: APPOINTMENTS_KEY,
  });
  return {
    shopId: data.shop.id,
    appointments: parseAppointments(data.shop.appointmentMetafield?.value),
  };
}

async function customerSummary(admin: unknown, customerId: string | null) {
  if (!customerId) return null;
  const data = await gql<{
    customer: {
      id: string;
      displayName: string;
      defaultEmailAddress: { emailAddress: string | null } | null;
      defaultPhoneNumber: { phoneNumber: string | null } | null;
      tags: string[];
    } | null;
  }>(admin, CUSTOMER_SUMMARY_QUERY, { id: customerId });
  return data.customer;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticatePos(request);

  return runRouteOp(async () => {
    const { appointments } = await getShopAppointments(admin);
    return okJson({
      appointments: upcoming(appointments).slice(0, 25),
      dayCounts: dayCounts(appointments),
    });
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return errorJson("BAD_REQUEST", "Method not allowed.", { status: 405 });
  }

  const { admin } = await authenticatePos(request);

  let body: AppointmentInput;
  try {
    body = (await request.json()) as AppointmentInput;
  } catch {
    return errorJson("BAD_REQUEST", "Invalid JSON body.");
  }

  let date: string;
  let time: string;
  try {
    date = cleanDate(body.date);
    time = cleanTime(body.time);
  } catch (err) {
    return errorJson("VALIDATION_FAILED", err instanceof Error ? err.message : "Invalid appointment details.");
  }

  const customerId = toCustomerGid(body.customerId);
  const durationMinutes = cleanDuration(body.durationMinutes);
  const appointmentType = cleanText(body.appointmentType, 80) || "In-person styling consult";
  const staffId = cleanText(body.staffId, 80) || null;
  const storeId = cleanText(body.storeId, 120) || null;
  const notes = cleanText(body.notes, 500);

  return runRouteOp(async () => {
    const [{ shopId, appointments }, customer] = await Promise.all([
      getShopAppointments(admin),
      customerSummary(admin, customerId),
    ]);

    const fallbackName = cleanText(body.customerName, 120) || "Walk-in client";
    const appointment: Appointment = {
      id: `appt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      customerId: customer?.id ?? customerId,
      customerName: customer?.displayName ?? fallbackName,
      customerEmail: customer?.defaultEmailAddress?.emailAddress ?? null,
      customerPhone: customer?.defaultPhoneNumber?.phoneNumber ?? null,
      customerTags: customer?.tags ?? [],
      date,
      time,
      startsAt: startsAtFor(date, time),
      durationMinutes,
      appointmentType,
      staffId,
      storeId,
      notes,
      status: "booked",
      createdAt: new Date().toISOString(),
    };

    const nextAppointments = [appointment, ...appointments]
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(-MAX_APPOINTMENTS);

    const set = await gql<{
      metafieldsSet: {
        metafields: Array<{ id: string; key: string; value: string }> | null;
        userErrors: Array<{ field?: string[]; message: string; code?: string }>;
      };
    }>(admin, METAFIELDS_SET_MUTATION, {
      metafields: [
        {
          ownerId: shopId,
          namespace: ELKA.shopMetafieldNamespace,
          key: APPOINTMENTS_KEY,
          type: "json",
          value: JSON.stringify(nextAppointments),
        },
      ],
    });

    const errors = userErrorsOf(set.metafieldsSet.userErrors);
    if (errors) {
      return errorJson("UPSTREAM_ERROR", "Could not save appointment.", { details: errors });
    }

    return okJson({
      appointment,
      appointments: upcoming(nextAppointments).slice(0, 25),
      dayCounts: dayCounts(nextAppointments),
    });
  });
}
