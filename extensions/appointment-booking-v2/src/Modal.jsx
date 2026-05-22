import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";

import {BACKEND_URL} from "./shared/config.js";

const CONSULT_TYPES = [
  "Styling consult",
  "VIP wardrobe refresh",
  "Concierge fitting",
  "Alterations follow-up",
  "New-season preview",
];
const TIMES = ["09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"];

export default async () => {
  render(<Extension />, document.body);
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {weekday: "short", month: "short", day: "numeric"}).format(new Date(`${value}T00:00:00`));
}

function formatTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat(undefined, {hour: "numeric", minute: "2-digit"}).format(date);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

function readPath(root, path) {
  let current = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstPresentString(values) {
  const found = values.find((value) => value != null && String(value).trim().length > 0);
  return found == null ? "" : String(found);
}

function currentStaffId() {
  return firstPresentString([
    readPath(shopify, ["staff", "id"]),
    readPath(shopify, ["staffMember", "id"]),
    readPath(shopify, ["staff", "current", "id"]),
    readPath(shopify, ["user", "id"]),
  ]);
}

function currentLocationGid() {
  const raw = firstPresentString([
    readPath(shopify, ["location", "current", "id"]),
    readPath(shopify, ["location", "id"]),
    readPath(shopify, ["pos", "location", "id"]),
  ]);
  if (!raw) return "";
  return raw.startsWith("gid://") ? raw : `gid://shopify/Location/${raw}`;
}

async function api(path, init = {}) {
  const token = await shopify.session.getSessionToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (init.body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {...headers, ...(init.headers || {})},
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error?.message || "Appointments request failed.");
  return json.data;
}

function badgeTone(tags) {
  const normalized = (tags || []).map((tag) => String(tag).toLowerCase());
  if (normalized.includes("concierge")) return "warning";
  if (normalized.includes("vip")) return "success";
  return "neutral";
}

function clientLabel(appointment) {
  const normalized = (appointment.customerTags || []).map((tag) => String(tag).toLowerCase());
  if (normalized.includes("concierge")) return `${appointment.customerName} · Concierge`;
  if (normalized.includes("vip")) return `${appointment.customerName} · VIP`;
  return appointment.customerName;
}

function CustomerCard({customer, selected, onSelect}) {
  const contact = customer.phone || customer.email || "No contact saved";
  return (
    <s-box padding="small">
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone={selected ? "success" : badgeTone(customer.tags)}>{selected ? "Selected" : customer.badges?.[0] || "Client"}</s-badge>
          <s-text type="strong">{customer.displayName}</s-text>
        </s-stack>
        <s-text tone="neutral">{contact}</s-text>
        <s-button variant={selected ? "primary" : "secondary"} onClick={() => onSelect(customer)}>
          {selected ? "Selected for appointment" : "Select client"}
        </s-button>
      </s-stack>
    </s-box>
  );
}

function AppointmentCard({appointment}) {
  const contact = appointment.customerPhone || appointment.customerEmail;
  return (
    <s-box padding="small">
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-icon type="calendar-time" tone="info" />
          <s-text type="strong">{formatTime(appointment.time)} · {appointment.appointmentType}</s-text>
        </s-stack>
        <s-badge tone={badgeTone(appointment.customerTags)}>{clientLabel(appointment)}</s-badge>
        <s-text tone="neutral">{appointment.durationMinutes} min{contact ? ` · ${contact}` : ""}</s-text>
        {appointment.notes ? <s-text>{appointment.notes}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

function AppointmentList({title, date, appointments, status, error}) {
  const filtered = appointments.filter((appointment) => appointment.date === date).sort((a, b) => a.time.localeCompare(b.time));
  return (
    <s-section heading={title}>
      <s-stack direction="block" gap="small">
        <s-text tone="neutral">{formatDate(date)}</s-text>
        {status === "loading" ? <s-spinner accessibilityLabel={`Loading ${title}`} /> : null}
        {status === "error" ? <s-banner tone="critical" heading="Couldn't load appointments"><s-text>{error}</s-text></s-banner> : null}
        {status === "loaded" && filtered.length === 0 ? <s-text tone="neutral">No consultations booked.</s-text> : null}
        {filtered.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} />)}
      </s-stack>
    </s-section>
  );
}

function Extension() {
  const {i18n} = shopify;
  const [tab, setTab] = useState("book");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [appointments, setAppointments] = useState([]);
  const [dayCounts, setDayCounts] = useState({});
  const [selectedDate, setSelectedDate] = useState(today());
  const [time, setTime] = useState("10:00");
  const [appointmentType, setAppointmentType] = useState(CONSULT_TYPES[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);

  const loadAppointments = () => {
    setStatus("loading");
    api("/api/appointments")
      .then((data) => {
        setAppointments(data.appointments || []);
        setDayCounts(data.dayCounts || {});
        setStatus("loaded");
      })
      .catch((err) => {
        setError(err.message || String(err));
        setStatus("error");
      });
  };

  useEffect(loadAppointments, []);

  const days = Array.from({length: 7}, (_, index) => addDays(index));
  const tomorrow = addDays(1);

  const searchCustomers = async () => {
    if (!query.trim()) {
      setSearchError("Enter a name, phone, or email to search.");
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const data = await api(`/api/customer/search?q=${encodeURIComponent(query.trim())}&limit=8`);
      setResults(data || []);
      if ((data || []).length === 0) setSearchError("No matching clients found. Create a new client below.");
    } catch (err) {
      setSearchError(err.message || String(err));
    } finally {
      setSearching(false);
    }
  };

  const createCustomer = async () => {
    setCreating(true);
    setSearchError("");
    try {
      const customer = await api("/api/customer/create", {
        method: "POST",
        body: JSON.stringify({name: newName, email: newEmail, phone: newPhone}),
      });
      setSelectedCustomer(customer);
      setResults([customer, ...results]);
      setQuery(customer.displayName);
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setMessage(`${customer.displayName} created and selected for this appointment.`);
    } catch (err) {
      setSearchError(err.message || String(err));
    } finally {
      setCreating(false);
    }
  };

  const save = async () => {
    if (!selectedCustomer) {
      setMessage("Select or create a client before booking.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const data = await api("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.displayName,
          date: selectedDate,
          time,
          durationMinutes: 45,
          appointmentType,
          staffId: currentStaffId(),
          storeId: currentLocationGid(),
          notes,
        }),
      });
      setAppointments(data.appointments || []);
      setDayCounts(data.dayCounts || {});
      setStatus("loaded");
      setMessage(`Booked ${data.appointment.customerName} for ${formatDate(data.appointment.date)} at ${formatTime(data.appointment.time)}.`);
      setNotes("");
      setTab("upcoming");
    } catch (err) {
      setMessage(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <s-page heading={i18n.translate("modal_heading")}>
      <s-scroll-box>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-section heading="Appointments">
              <s-stack direction="inline" gap="small">
                <s-button variant={tab === "book" ? "primary" : "secondary"} onClick={() => setTab("book")}>Book appointment</s-button>
                <s-button variant={tab === "upcoming" ? "primary" : "secondary"} onClick={() => setTab("upcoming")}>Today & tomorrow</s-button>
              </s-stack>
            </s-section>

            {message ? <s-banner tone={message.startsWith("Booked") || message.includes("created") ? "success" : "critical"} heading={message} /> : null}

            {tab === "book" ? (
              <s-stack direction="block" gap="base">
                <s-section heading="Find client">
                  <s-stack direction="block" gap="small">
                    <s-text-field label="Search customers" value={query} placeholder="Name, phone, or email" onInput={(event) => setQuery(event.currentTarget.value)} />
                    <s-button variant="primary" loading={searching} onClick={searchCustomers}>Search clients</s-button>
                    {searchError ? <s-text tone="critical">{searchError}</s-text> : null}
                    {selectedCustomer ? <s-banner tone="success" heading={`Selected: ${selectedCustomer.displayName}`} /> : null}
                    {results.map((customer) => (
                      <CustomerCard
                        key={customer.id}
                        customer={customer}
                        selected={selectedCustomer?.id === customer.id}
                        onSelect={setSelectedCustomer}
                      />
                    ))}
                  </s-stack>
                </s-section>

                <s-section heading="Create new client">
                  <s-stack direction="block" gap="small">
                    <s-text-field label="Name" value={newName} placeholder="Client name" onInput={(event) => setNewName(event.currentTarget.value)} />
                    <s-text-field label="Email" value={newEmail} placeholder="client@example.com" onInput={(event) => setNewEmail(event.currentTarget.value)} />
                    <s-text-field label="Phone" value={newPhone} placeholder="Phone number" onInput={(event) => setNewPhone(event.currentTarget.value)} />
                    <s-button variant="secondary" loading={creating} disabled={creating || (!newName.trim() && !newEmail.trim() && !newPhone.trim())} onClick={createCustomer}>
                      Create and select client
                    </s-button>
                  </s-stack>
                </s-section>

                <s-section heading="Appointment details">
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small">
                      {CONSULT_TYPES.map((type) => (
                        <s-button key={type} variant={appointmentType === type ? "primary" : "secondary"} onClick={() => setAppointmentType(type)}>
                          {type}
                        </s-button>
                      ))}
                    </s-stack>
                    <s-stack direction="inline" gap="small">
                      {days.map((day) => (
                        <s-button key={day} variant={selectedDate === day ? "primary" : "secondary"} onClick={() => setSelectedDate(day)}>
                          {formatDate(day)}{dayCounts[day] ? ` · ${dayCounts[day]}` : ""}
                        </s-button>
                      ))}
                    </s-stack>
                    <s-stack direction="inline" gap="small">
                      {TIMES.map((slot) => (
                        <s-button key={slot} variant={time === slot ? "primary" : "secondary"} onClick={() => setTime(slot)}>
                          {formatTime(slot)}
                        </s-button>
                      ))}
                    </s-stack>
                    <s-text-area label="Appointment notes" value={notes} placeholder="Occasion, sizing, pieces to prepare, fitting needs…" onInput={(event) => setNotes(event.currentTarget.value)} />
                    <s-button variant="primary" loading={saving} disabled={saving || !selectedCustomer} onClick={save}>
                      Book appointment
                    </s-button>
                  </s-stack>
                </s-section>
              </s-stack>
            ) : (
              <s-stack direction="block" gap="base">
                <AppointmentList title="Today" date={today()} appointments={appointments} status={status} error={error} />
                <AppointmentList title="Tomorrow" date={tomorrow} appointments={appointments} status={status} error={error} />
                <s-button variant="secondary" onClick={loadAppointments}>Refresh appointments</s-button>
              </s-stack>
            )}
          </s-stack>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
}
