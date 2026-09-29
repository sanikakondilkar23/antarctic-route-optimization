import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'

/* ---- The eleven product routes ---------------------------------- */
import Overview from './pages/Overview'
import Navigation from './pages/Navigation'
import Environment from './pages/Environment'
import SicForecast from './pages/SicForecast'
import IcebergIntelligence from './pages/IcebergIntelligence'
import EnvironmentalRisk from './pages/EnvironmentalRisk'
import RoutePlanner from './pages/RoutePlanner'
import Models from './pages/Models'
import About from './pages/About'
import ShipDetails from './pages/ShipDetails'

import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

/* ---- Preserved pages from the earlier build -----------------------
 * They stay routed so no historical link can ever resolve to a 404, but
 * they are not promoted in the sidebar. Nothing here is deleted.
 */
import Dashboard from './pages/Dashboard'
import MissionControl from './pages/MissionControl'
import SystemStatus from './pages/SystemStatus'
import IcebergTracking from './pages/IcebergTracking'
import MapExplorer from './pages/MapExplorer'
import RiskUncertainty from './pages/RiskUncertainty'
import RoutePlanning from './pages/RoutePlanning'
import SeaIceForecast from './pages/SeaIceForecast'

/**
 * AURORA route table.
 *
 * The public face is `/` (landing) and `/login`. Everything else lives inside
 * AppLayout behind the demo session: Overview, Navigation, Environment,
 * Sea-Ice, Icebergs, Risk Analytics, Routes, Ship Details, Models and About.
 * Each of those renders a real page backed by a real endpoint - none is a
 * placeholder.
 *
 * Every page renders only values its API returned. Anything the API does not
 * publish is shown as "Unavailable" / "Integration pending" with the reason -
 * never as a zero, and never as a number invented here.
 */
export default function App() {
  return (
    <Routes>
      {/* ---------------------------------------------------------- Public */}
      <Route path="/" element={<Navigate to="/landing" replace />} />
      <Route path="/landing" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      {/* ------------------------------------------- Authenticated product */}
      <Route element={<AppLayout />}>
        <Route path="/overview" element={<Overview />} />
        <Route path="/navigation" element={<Navigation />} />
        <Route path="/environment" element={<Environment />} />
        <Route path="/sea-ice" element={<SicForecast />} />
        <Route path="/icebergs" element={<IcebergIntelligence />} />
        <Route path="/risk" element={<EnvironmentalRisk />} />
        <Route path="/routes" element={<RoutePlanner />} />
        <Route path="/ship-details" element={<ShipDetails />} />
        <Route path="/models" element={<Models />} />
        <Route path="/about" element={<About />} />

        {/* Preserved pages from the earlier build */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/mission-control" element={<MissionControl />} />
        <Route path="/system" element={<SystemStatus />} />
        <Route path="/iceberg-tracking" element={<IcebergTracking />} />
        <Route path="/map-explorer" element={<MapExplorer />} />
        <Route path="/risk-uncertainty" element={<RiskUncertainty />} />
        <Route path="/route-planning" element={<RoutePlanning />} />
        <Route path="/sea-ice-forecast" element={<SeaIceForecast />} />
      </Route>

      {/* ------------------------------------- Legacy paths (redirects) */}
      <Route path="/route" element={<Navigate to="/routes" replace />} />
      <Route path="/sic" element={<Navigate to="/sea-ice" replace />} />
      <Route path="/iceberg" element={<Navigate to="/icebergs" replace />} />
      <Route path="/route-planner" element={<Navigate to="/routes" replace />} />
      <Route path="/sic-forecast" element={<Navigate to="/sea-ice" replace />} />
      <Route path="/environmental-risk" element={<Navigate to="/risk" replace />} />
      <Route path="/system-status" element={<Navigate to="/dashboard" replace />} />
      <Route path="/ships" element={<Navigate to="/ship-details" replace />} />
      <Route path="/fleet" element={<Navigate to="/ship-details" replace />} />

      <Route path="/not-found" element={<NotFound />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
