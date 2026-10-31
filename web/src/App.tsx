// App.tsx - the nav bar plus "which URL shows which screen, for which role".
//
// Three "portals" share one website:
//   GUEST   -> search, book, My bookings (with the bill)
//   MANAGER -> front desk (all bookings, check-in, room board, folio) + rooms admin
//   ADMIN   -> everything a manager has + Managers page
// The nav only SHOWS links for your role; the API is what really enforces it.
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { homeFor, RequireRole, useAuth } from './auth';
import type { Role } from './api';
import { Loading } from './components';
import SearchPage from './pages/SearchPage';
import BookPage from './pages/BookPage';
import BookingsPage from './pages/BookingsPage';
import BookingDetailPage from './pages/BookingDetailPage';
import CheckInPage from './pages/CheckInPage';
import RoomBoardPage from './pages/RoomBoardPage';
import FolioPage from './pages/FolioPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ManageRoomsPage from './pages/ManageRoomsPage';
import AdminPage from './pages/AdminPage';

const STAFF: Role[] = ['MANAGER', 'ADMIN'];
const ANYONE: Role[] = ['GUEST', 'MANAGER', 'ADMIN'];

// [url, label, roles that see it]. null roles = only when logged OUT.
const links: [string, string, Role[] | null][] = [
  ['/search', 'Availability', ['GUEST', 'MANAGER', 'ADMIN']],
  ['/book', 'Book a room', ['GUEST']],
  ['/bookings', 'My bookings', ['GUEST']],
  ['/book', 'Walk-in booking', STAFF],
  ['/bookings', 'All bookings', STAFF],
  ['/check-in', 'Check-in', STAFF],
  ['/rooms', 'Room board', STAFF],
  ['/folio', 'Folio & checkout', STAFF],
  ['/manage', 'Rooms & types', STAFF],
  ['/admin', 'Managers', ['ADMIN']],
  ['/login', 'Log in', null],
  ['/signup', 'Sign up', null],
];

export default function App() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  // Logged in: links for my role. Logged out: Availability + Log in + Sign up.
  const visible = links.filter(([to, , roles]) =>
    user ? roles?.includes(user.role) : roles === null || to === '/search');

  async function doLogout() {
    await logout();
    navigate('/login');
  }

  if (loading) return <main className="page"><Loading /></main>;

  return (
    <>
      <header className="nav">
        <span className="brand">🏨 Guest House{user && user.role !== 'GUEST' && <small className="role-tag">{user.role}</small>}</span>
        <nav>
          {visible.map(([to, label]) => <NavLink key={to + label} to={to} end={to === '/bookings'}>{label}</NavLink>)}
        </nav>
        {user && (
          <span className="who">
            {user.full_name}
            <button className="link-btn" onClick={doLogout}>Log out</button>
          </span>
        )}
      </header>
      <main className="page">
        <Routes>
          {/* "/" sends each role to its own start page */}
          <Route path="/" element={<Navigate to={user ? homeFor(user.role) : '/search'} replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          {/* Searching is public: visitors can look before signing up. */}
          <Route path="/search" element={<SearchPage />} />

          {/* Guests AND staff (each sees their own version) */}
          <Route path="/book" element={<RequireRole roles={ANYONE}><BookPage /></RequireRole>} />
          <Route path="/bookings" element={<RequireRole roles={ANYONE}><BookingsPage /></RequireRole>} />
          {/* :id is a URL parameter - /bookings/7 gives id = "7" */}
          <Route path="/bookings/:id" element={<RequireRole roles={ANYONE}><BookingDetailPage /></RequireRole>} />

          {/* Staff only */}
          <Route path="/check-in" element={<RequireRole roles={STAFF}><CheckInPage /></RequireRole>} />
          <Route path="/rooms" element={<RequireRole roles={STAFF}><RoomBoardPage /></RequireRole>} />
          <Route path="/folio" element={<RequireRole roles={STAFF}><FolioPage /></RequireRole>} />
          <Route path="/folio/:id" element={<RequireRole roles={STAFF}><FolioPage /></RequireRole>} />
          <Route path="/manage" element={<RequireRole roles={STAFF}><ManageRoomsPage /></RequireRole>} />

          {/* Admin only */}
          <Route path="/admin" element={<RequireRole roles={['ADMIN']}><AdminPage /></RequireRole>} />

          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
