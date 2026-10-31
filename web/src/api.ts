// api.ts - the ONLY place that knows where the API lives and how to talk to it.
// WHY one file? If the API moves (another port, a real server), you change one
// line here instead of hunting through every screen.

// '/api' = "same website, path /api". Vite (in dev, see vite.config.ts) and
// nginx (in Docker) forward /api/... to the API server. Same origin means the
// login cookie just works and we avoid CORS trouble.
// To call an API on another address, build with VITE_API_URL=https://... set.
export const API_URL: string = import.meta.env.VITE_API_URL ?? '/api';

// ---------- Types: the shapes the API sends back (see api/API_README.md) ----------
export type BookingStatus = 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
export type FolioKind = 'CHARGE' | 'PAYMENT' | 'CREDIT' | 'REFUND';

export interface Guest { id: number; name: string; phone: string; email: string | null }
export interface RoomType { id: number; name: string; capacity: number; rate_paise: number; rooms: number }
export interface AvailabilityRow {
  room_type_id: number; name: string; capacity: number; rate_paise: number; max_booked: number; free: number;
}
export interface Booking {
  id: number; guest_id: number; room_type_id: number; status: BookingStatus;
  check_in: string; check_out: string; created_at: string;
  guest_name?: string; room_type?: string;   // filled in by the list and detail endpoints
}
export interface Stay { id: number; room_id: number; room_number: string; status: string; from_date: string; to_date: string }
export interface BookingEvent { id: number; event_type: string; details: unknown; created_at: string }
export interface BookingDetail extends Booking { stays: Stay[]; events: BookingEvent[]; balance_paise: number }
export interface FreeRoom { id: number; room_number: string; room_type_id: number }
export interface FolioLine { id: number; kind: FolioKind; amount_paise: number; description: string; created_at: string }
export interface Folio { booking_id: number; lines: FolioLine[]; balance_paise: number }
export type Role = 'GUEST' | 'MANAGER' | 'ADMIN';
export interface User { id: number; email: string; full_name: string; role: Role; guest_id: number | null }
export interface StaffUser { id: number; email: string; full_name: string; role: Role; created_at: string }
export interface Room { id: number; room_number: string; room_type_id: number; room_type?: string }
export type RoomTypeInput = { name: string; capacity: number; rate_paise: number };

// ---------- Errors ----------
// WHY a class? Screens need the STATUS (409 = sold out, 422 = unpaid bill...)
// to show the right friendly message, not just "something failed".
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// One helper does every request: adds JSON headers, and turns a non-2xx
// response into an ApiError carrying the API's own {error: "..."} text.
async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      // 'include' = send the login cookie with every request (needed if the
      // API is on another address; harmless when it's the same site).
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch only throws when it can't reach the server at all.
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Is "npm run dev" running in the api folder?`);
  }
  if (res.status === 204) return undefined as T;     // 204 = success with no body (e.g. delete)
  const data = await res.json().catch(() => null);   // some errors may not be JSON
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

// Builds "?a=1&b=2" safely (URLSearchParams escapes odd characters for us).
const qs = (p: Record<string, string | number>) =>
  '?' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();

// ---------- One small function per endpoint ----------
export const api = {
  // --- login ---
  me: () => request<{ user: User }>('GET', '/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/auth/login', { email, password }),
  signup: (d: { email: string; password: string; full_name: string; phone: string }) =>
    request<{ user: User }>('POST', '/auth/signup', d),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  // --- admin ---
  staff: () => request<StaffUser[]>('GET', '/admin/users'),
  createManager: (d: { email: string; password: string; full_name: string }) =>
    request<StaffUser>('POST', '/admin/users', d),
  // --- rooms & room types (manager) ---
  rooms: () => request<Room[]>('GET', '/rooms'),
  createRoom: (r: { room_number: string; room_type_id: number }) => request<Room>('POST', '/rooms', r),
  updateRoom: (id: number, r: { room_number: string; room_type_id: number }) => request<Room>('PUT', `/rooms/${id}`, r),
  deleteRoom: (id: number) => request<void>('DELETE', `/rooms/${id}`),
  createRoomType: (t: RoomTypeInput) => request<RoomType>('POST', '/room-types', t),
  updateRoomType: (id: number, t: RoomTypeInput) => request<RoomType>('PUT', `/room-types/${id}`, t),
  deleteRoomType: (id: number) => request<void>('DELETE', `/room-types/${id}`),
  // --- bookings ---
  roomTypes: () => request<RoomType[]>('GET', '/room-types'),
  availability: (check_in: string, check_out: string) =>
    request<{ check_in: string; check_out: string; room_types: AvailabilityRow[] }>('GET', '/availability' + qs({ check_in, check_out })),
  createGuest: (g: { name: string; phone: string; email?: string }) => request<Guest>('POST', '/guests', g),
  // guest_id is only used when STAFF book; for a guest the API uses their own.
  createBooking: (b: { guest_id?: number; room_type_id: number; check_in: string; check_out: string }) =>
    request<{ id: number; status: BookingStatus }>('POST', '/bookings', b),
  listBookings: (status?: BookingStatus) =>
    request<Booking[]>('GET', '/bookings' + (status ? qs({ status }) : '')),
  booking: (id: number) => request<BookingDetail>('GET', `/bookings/${id}`),
  cancel: (id: number) => request<{ id: number; status: BookingStatus }>('POST', `/bookings/${id}/cancel`),
  freeRooms: (room_type_id: number, check_in: string, check_out: string) =>
    request<FreeRoom[]>('GET', '/rooms/free' + qs({ room_type_id, check_in, check_out })),
  checkIn: (id: number, room_id: number) => request<{ stay_id: number }>('POST', `/bookings/${id}/check-in`, { room_id }),
  changeRoom: (id: number, new_room_id: number, on_date?: string) =>
    request<{ stay_id: number }>('POST', `/bookings/${id}/change-room`, { new_room_id, on_date }),
  checkOut: (id: number) => request<{ status: BookingStatus }>('POST', `/bookings/${id}/check-out`),
  folio: (id: number) => request<Folio>('GET', `/bookings/${id}/folio`),
  addFolioLine: (id: number, line: { kind: FolioKind; amount_paise: number; description?: string }) =>
    request<FolioLine>('POST', `/bookings/${id}/folio`, line),
};
