import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Fleet from './pages/Fleet'
import ShipDetails from './pages/ShipDetails'
import MapExplorer from './pages/MapExplorer'
import IcebergTracking from './pages/IcebergTracking'
import SeaIceForecast from './pages/SeaIceForecast'
import RoutePlanning from './pages/RoutePlanning'
import Alerts from './pages/Alerts'
import DataSources from './pages/DataSources'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/fleet" element={<Fleet />} />
        <Route path="/fleet/:id" element={<ShipDetails />} />
        <Route path="/map" element={<MapExplorer />} />
        <Route path="/icebergs" element={<IcebergTracking />} />
        <Route path="/sea-ice" element={<SeaIceForecast />} />
        <Route path="/route-planner" element={<RoutePlanning />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/data-sources" element={<DataSources />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="/not-found" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}