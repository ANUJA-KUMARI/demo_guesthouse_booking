// Screen 1 - Availability search.
// The guest picks dates; we ask GET /availability how many rooms of each type are free.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { AvailabilityRow } from '../api';
import { Loading, Message } from '../components';
import { errorText, isoDate, rupees } from '../format';

export default function SearchPage() {
  // Default: tonight to tomorrow, so the form is never empty.
  const [checkIn, setCheckIn] = useState(isoDate(0));
  const [checkOut, setCheckOut] = useState(isoDate(1));
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function search(e: FormEvent) {
    e.preventDefault();               // stop the browser reloading the page on submit
    setError(''); setLoading(true);
    try {
      const r = await api.availability(checkIn, checkOut);
      setRows(r.room_types);
    } catch (err) {
      setError(errorText(err)); setRows(null);
    } finally {
      setLoading(false);              // runs on success AND failure
    }
  }

  // Number of nights = days between the dates (checkout day is not a night).
  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);

  return (
    <section>
      <h1>Availability</h1>
      <form className="row" onSubmit={search}>
        <label>Check-in <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required /></label>
        <label>Check-out <input type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} required /></label>
        <button type="submit">Search</button>
      </form>
      <Message kind="error">{error}</Message>
      {loading && <Loading />}
      {rows && !loading && (
        <>
          <p className="muted">Free = rooms left on the busiest night of your stay. The final check happens when you book.</p>
          <table>
            <thead><tr><th>Room type</th><th>Capacity</th><th>Free</th><th>Rate / night</th><th>Total ({nights} nights)</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.room_type_id}>
                  <td>{r.name}</td>
                  <td>{r.capacity}</td>
                  <td>{r.free > 0 ? r.free : <span className="sold">Sold out</span>}</td>
                  <td>{rupees(r.rate_paise)}</td>
                  <td>{rupees(r.rate_paise * nights)}</td>
                  <td>
                    {/* Pass the choice to the booking form in the URL, so it arrives prefilled. */}
                    <button disabled={r.free <= 0}
                      onClick={() => navigate(`/book?room_type_id=${r.room_type_id}&check_in=${checkIn}&check_out=${checkOut}`)}>
                      Book
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
