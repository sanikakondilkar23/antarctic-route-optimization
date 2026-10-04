import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import MissionControl from './pages/MissionControl'
import RoutePlanner from './pages/RoutePlanner'
import SicForecast from './pages/SicForecast'
import IcebergIntelligence from './pages/IcebergIntelligence'
import EnvironmentalRisk from './pages/EnvironmentalRisk'
import SystemStatus from './pages/SystemStatus'
import NotFound from './pages/NotFound'

/**
 * AURORA route table.
 *
 * The order below is the product's navigation order, and it matches
 * NAV_ITEMS in components/layout/AppShell.jsx: Mission Control, Route
 * Planner, SIC Forecast, Iceberg Intelligence, Environmental Risk, System.
 *
 * Every page renders only values its API endpoint returned. Anything the API
 * does not publish is shown as "Data unavailable" with the reason - never as
 * a zero, and never as a number that was invented here.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/landing" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<MissionControl />} />
        <Route path="/console" element={<MissionControl />} />
        <Route path="/mission-control" element={<MissionControl />} />
        <Route path="/route-planner" element={<RoutePlanner />} />
        <Route path="/sic-forecast" element={<SicForecast />} />
        <Route path="/icebergs" element={<IcebergIntelligence />} />
        <Route path="/risk" element={<EnvironmentalRisk />} />
        <Route path="/system" element={<SystemStatus />} />
      </Route>

      {/* Legacy and standalone model alias paths */}
      <Route path="/model-1" element={<Navigate to="/sic-forecast" replace />} />
      <Route path="/model-2" element={<Navigate to="/route-planner" replace />} />
      <Route path="/model-3" element={<Navigate to="/icebergs" replace />} />
      <Route path="/sic-forecaster" element={<Navigate to="/sic-forecast" replace />} />
      <Route path="/route-optimizer" element={<Navigate to="/route-planner" replace />} />
      <Route path="/iceberg-detector" element={<Navigate to="/icebergs" replace />} />
      <Route path="/sea-ice" element={<Navigate to="/sic-forecast" replace />} />
      <Route path="/system-status" element={<Navigate to="/system" replace />} />

      <Route path="/not-found" element={<NotFound />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
