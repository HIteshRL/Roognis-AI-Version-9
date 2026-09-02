import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import AppShell from './components/AppShell.jsx'
import { Loading } from './components/ui'
import Login from './pages/Login.jsx'

/**
 * Routes.
 *
 * The Command Center surfaces are lazy: each is a separate chunk, so signing in
 * as a student never downloads the intervention ruleset, and a teacher landing
 * on the dashboard does not pay for the calendar. The existing LMS screens stay
 * eagerly loaded — they are small and already in the initial bundle.
 */
const TeacherDashboard = lazy(() => import('./features/dashboard/pages/TeacherDashboard'))
const ClassroomTimeline = lazy(() => import('./features/timeline/pages/ClassroomTimeline'))
const AIInbox = lazy(() => import('./features/ai-inbox/pages/AIInbox'))
const InsightDetails = lazy(() => import('./features/ai-inbox/pages/InsightDetails'))
const StudentIntervention = lazy(() => import('./features/interventions/pages/StudentIntervention'))
const CalendarPage = lazy(() => import('./features/calendar/pages/CalendarPage'))

const Classrooms = lazy(() => import('./pages/Classrooms.jsx'))
const Classroom = lazy(() => import('./pages/Classroom.jsx'))
const CourseworkDetail = lazy(() => import('./pages/CourseworkDetail.jsx'))
const Guardian = lazy(() => import('./pages/Guardian.jsx'))

/** Routes only a teacher may open; students and parents are sent home. */
function TeacherOnly({
  role,
  home,
  children,
}: {
  role: string | undefined
  home: string
  children: JSX.Element
}): JSX.Element {
  return role === 'teacher' ? children : <Navigate to={home} replace />
}

export default function App(): JSX.Element {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Loading label="Starting Roognis…" />
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  const home = user.role === 'parent' ? '/guardian' : user.role === 'teacher' ? '/dashboard' : '/classes'

  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="/dashboard"
            element={
              <TeacherOnly role={user.role} home={home}>
                <TeacherDashboard />
              </TeacherOnly>
            }
          />
          <Route
            path="/inbox"
            element={
              <TeacherOnly role={user.role} home={home}>
                <AIInbox />
              </TeacherOnly>
            }
          />
          <Route
            path="/inbox/:insightId"
            element={
              <TeacherOnly role={user.role} home={home}>
                <InsightDetails />
              </TeacherOnly>
            }
          />
          <Route
            path="/interventions"
            element={
              <TeacherOnly role={user.role} home={home}>
                <StudentIntervention />
              </TeacherOnly>
            }
          />

          <Route path="/classes" element={<Classrooms />} />
          <Route path="/classes/:id" element={<Classroom />} />
          <Route path="/classes/:id/timeline" element={<ClassroomTimeline />} />
          <Route path="/classes/:id/work/:cwId" element={<CourseworkDetail />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/guardian" element={<Guardian />} />

          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
